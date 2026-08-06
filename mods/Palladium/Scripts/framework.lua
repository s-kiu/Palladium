-- The modding framework: Palladium loading, registering and driving other mods.
--
-- A mod is a folder beside this one with a `mod.lua` that returns a table. It
-- has no `Scripts/main.lua`, so UE4SS never loads it — Palladium does, with
-- `loadfile`, into this Lua state. That is the whole reason a mod can be a
-- table of functions rather than a process: there is only one state, so
-- registering a handler is an assignment, not a protocol.
--
--   return {
--     name = "GoldStreak",
--     permissions = { { node = "goldstreak.reward", default = "allow" } },
--     settings = { every = 5 },
--     on = { ["player.respawn"] = function(event, pal) … end },
--     commands = { ["!streak"] = { run = function(event, args, pal) … end } },
--   }
--
-- The manifest is Lua because Palladium can write JSON but cannot read it.
-- A Lua table needs no parser, and `loadfile` with an environment gives one
-- for free — mods are read with the same call that loads them.

local framework = {}

-- The shape of a mod: what `on`, `commands`, `data` and `pal` mean. A mod may
-- declare which one it was written against, and the framework loads the ones
-- it still understands. This is the whole compatibility story, deliberately:
-- a mod written for an API this framework no longer speaks is refused with the
-- reason, rather than loading and misbehaving in a way the author cannot see.
--
--   1  the first published shape
--
-- Bump on a breaking change to that vocabulary, and add the old number to
-- SUPPORTED for as long as the old shape still works.
local API = 1
local SUPPORTED = { [1] = true }

local MAX_QUEUE = 500
local COMMAND_COOLDOWN_S = 2

local host = {
    info = function() end,
    call = function() end,
    root = "/palworld",
    mods_dir = "Mods",
    json_string = tostring,
}

framework.API = API
framework.mods = {}   -- name → entry
framework.order = {}  -- load order, for deterministic dispatch and snapshots

local queue = {}
local dropped = 0
local last_command = {} -- userid → epoch

local function log(text)
    host.info("framework: " .. text)
end

-- ── discovery ───────────────────────────────────────────────────────────────
-- Plain Lua has no readdir, so this tries the three routes that exist in this
-- loader, cheapest first, and says which one answered. A list file is the only
-- one guaranteed to work everywhere; pal-up writes it, and standalone servers
-- can maintain it by hand the way BPModLoaderMod's load_order.txt is.

local function exists(path)
    local file = io.open(path, "r")
    if file then file:close() end
    return file ~= nil
end

local function from_list_file(dir)
    local path = dir .. "/Palladium/mods.list"
    if not exists(path) then return nil end
    local names = {}
    for line in io.lines(path) do
        local name = line:match("^%s*([%w_%.%-]+)%s*$")
        if name and not line:match("^%s*;") then names[#names + 1] = name end
    end
    return names, "mods.list"
end

local function from_iterate(dir)
    if type(IterateGameDirectories) ~= "function" then return nil end
    local ok, dirs = pcall(IterateGameDirectories)
    if not ok or type(dirs) ~= "table" then return nil end
    -- The tree this returns is keyed by directory name at every level; the
    -- Mods folder is only in it on some builds, which is why this is not the
    -- only route.
    local mods = dirs[dir] or (dirs.Binaries and dirs.Binaries[dir])
    if type(mods) ~= "table" then return nil end
    local names = {}
    for name, entry in pairs(mods) do
        if type(name) == "string" and type(entry) == "table" then names[#names + 1] = name end
    end
    table.sort(names)
    return names, "IterateGameDirectories"
end

local function from_shell(dir)
    if type(io.popen) ~= "function" then return nil end
    local ok, pipe = pcall(io.popen, "ls -1 '" .. dir:gsub("'", "") .. "' 2>/dev/null")
    if not ok or not pipe then return nil end
    local names = {}
    for line in pipe:lines() do
        local name = line:match("^([%w_%.%-]+)$")
        if name then names[#names + 1] = name end
    end
    pipe:close()
    if #names == 0 then return nil end
    return names, "directory listing"
end

local function discover(dir)
    for _, route in ipairs({ from_list_file, from_iterate, from_shell }) do
        local names, how = route(dir)
        if names and #names > 0 then return names, how end
    end
    return {}, "nothing"
end

-- ── loading ─────────────────────────────────────────────────────────────────

local function validate(name, mod)
    if type(mod) ~= "table" then return "mod.lua did not return a table" end
    -- Undeclared means "written against whatever was current", which is the
    -- honest reading for every mod written before this existed.
    local wants = mod.api == nil and API or mod.api
    if type(wants) ~= "number" or not SUPPORTED[wants] then
        return string.format(
            "written for Palladium mod API %s; this Palladium speaks %d",
            tostring(mod.api), API)
    end
    if mod.name ~= nil and mod.name ~= name then
        return string.format('mod.lua says name "%s" but the folder is "%s"', tostring(mod.name), name)
    end
    if mod.on ~= nil and type(mod.on) ~= "table" then return "`on` must be a table of handlers" end
    for event_type, handler in pairs(mod.on or {}) do
        if type(handler) ~= "function" then
            return string.format("handler for %s is not a function", tostring(event_type))
        end
    end
    if mod.data ~= nil and type(mod.data) ~= "table" then return "`data` must be a table" end
    for collection, spec in pairs(mod.data or {}) do
        if type(collection) ~= "string" or not collection:lower():match("^[a-z][a-z0-9_]*$") then
            return string.format("not a collection name: %s", tostring(collection))
        end
        if type(spec) ~= "table" then
            return string.format("collection %s must be declared with a table", collection)
        end
        if spec.storage ~= nil and spec.storage ~= "data" and spec.storage ~= "config" then
            return string.format('collection %s: storage must be "data" or "config"', collection)
        end
        if spec.fields ~= nil and type(spec.fields) ~= "table" then
            return string.format("collection %s: fields must be a table", collection)
        end
    end
    if mod.commands ~= nil and type(mod.commands) ~= "table" then return "`commands` must be a table" end
    for word, command in pairs(mod.commands or {}) do
        if type(command) ~= "table" or type(command.run) ~= "function" then
            return string.format("command %s needs a run function", tostring(word))
        end
    end
    -- A mod owns its own namespace and only its own, the same rule the panel
    -- enforces: otherwise the first mod to load could redefine another's.
    local prefix = name:lower() .. "."
    for _, entry in ipairs(mod.permissions or {}) do
        if type(entry) ~= "table" or type(entry.node) ~= "string" then return "each permission needs a node" end
        if entry.node:sub(1, #prefix) ~= prefix then
            return string.format('permission "%s" must start with "%s"', entry.node, prefix)
        end
        if entry.default ~= nil and entry.default ~= "allow" and entry.default ~= "deny" then
            return string.format('permission "%s": default must be "allow" or "deny"', entry.node)
        end
    end
    return nil
end

-- A handler for an event Palladium never publishes would simply never run,
-- which is the worst way to find out about a typo — or about `player.leave`,
-- which for a long time was written by the panel and so could not reach a mod
-- in here at all.
local function unfireable(mod)
    local found = {}
    if not host.event_types then return found end
    for event_type in pairs(mod.on or {}) do
        if not host.event_types[event_type] then
            found[#found + 1] = string.format("no such event: %s — this handler will never fire", event_type)
        end
    end
    table.sort(found)
    return found
end

-- Each mod reads the globals it needs and writes only to itself. A mod that
-- assigns a global is not a mod that breaks Palladium's.
local function sandbox()
    return setmetatable({}, { __index = _G })
end

local function api_for(name, mod)
    local pal = {
        name = name,
        settings = mod.settings or {},
    }

    function pal.log(text)
        host.info(name .. ": " .. tostring(text))
    end

    -- Every capability, by the manifest's own names. `done` is optional and
    -- receives (ok, err, data) — actions reach the engine on the game thread,
    -- so an answer is not available on return.
    function pal.call(action_type, userid, params, done)
        host.call(action_type, userid or "", params or {}, function(ok, err, data)
            if done then
                local safe, failure = pcall(done, ok, err, data)
                if not safe then host.info(name .. ": " .. action_type .. " callback failed: " .. tostring(failure)) end
            end
        end)
    end

    function pal.message(userid, text, done)
        pal.call("player.message", userid, { text = text }, done)
    end

    function pal.give(userid, item, count, done)
        pal.call("player.give_item", userid, { item = item, count = count or 1 }, done)
    end

    function pal.heal(userid, done)
        pal.call("player.heal", userid, {}, done)
    end

    -- Tell everyone online. The agent sends it to each player itself, so this
    -- works with nothing outside the game.
    function pal.announce(message, done)
        pal.call("server.announce", nil, { message = message }, done)
    end

    -- Resolved against the store: the player's own overrides, then their
    -- groups by weight, then the default group, then the node's registered
    -- default. A node nobody registered is denied.
    -- `params` are what the mod is about to do. Pass them and a grant like
    -- "only Lamball" is honoured; leave them out and a constrained grant
    -- answers no, because it cannot be checked.
    function pal.can(userid, node, params)
        if not host.permissions then return false end
        return (host.permissions:resolve(userid or "", node, params)) == true
    end

    -- Tags are namespaced by mod, so two mods can both keep a "count" without
    -- ever having to know about each other.
    local function tag_id(userid, key)
        return tostring(userid or "") .. "\30" .. name:lower() .. "." .. tostring(key or "")
    end

    function pal.tag(userid, key)
        local record = host.tags and host.tags:get(tag_id(userid, key))
        return record and record.value or nil
    end

    function pal.set_tag(userid, key, value)
        if not host.tags then return false end
        return host.tags:set(tag_id(userid, key), {
            uid = userid, key = name:lower() .. "." .. tostring(key), value = value,
        })
    end

    function pal.delete_tag(userid, key)
        return host.tags ~= nil and host.tags:delete(tag_id(userid, key))
    end

    -- The mod's own declared collections, by the short name it used. Only its
    -- own: the namespace rule that keeps permissions honest applies here too.
    function pal.data(collection)
        if not host.collections then return nil end
        return host.collections.open(name:lower() .. "." .. tostring(collection):lower())
    end

    return pal
end

function framework.load()
    framework.mods = {}
    framework.order = {}
    local dir = host.mods_dir
    local names, how = discover(dir)
    log(string.format("scanning %s via %s — %d folder(s)", dir, how, #names))

    for _, name in ipairs(names) do
        local path = dir .. "/" .. name .. "/mod.lua"
        if exists(path) then
            local entry = { name = name, path = path, ok = false, error = nil, mod = nil }
            local chunk, load_error = loadfile(path, "t", sandbox())
            if not chunk then
                entry.error = tostring(load_error)
            else
                local ran, result = pcall(chunk)
                if not ran then
                    entry.error = tostring(result)
                else
                    entry.error = validate(name, result)
                    if not entry.error then
                        entry.ok = true
                        entry.mod = result
                        entry.pal = api_for(name, result)
                        entry.warnings = unfireable(result)
                    end
                end
            end
            framework.mods[name] = entry
            framework.order[#framework.order + 1] = name
            -- A mod's nodes are registered whether or not anyone has granted
            -- them: the panel lists what exists, and a default of "deny" only
            -- means something once the node is known.
            if entry.ok and host.permissions then
                host.permissions:register(name:lower(), entry.mod.permissions or {})
            end
            -- A mod's collections exist from the moment it loads, so the panel
            -- can list an empty one rather than nothing at all — and they live
            -- in the mod's own folder, so its config and its records travel
            -- with it and deleting the folder is a clean uninstall.
            if entry.ok and host.collections then
                host.collections.home(name, host.home_for and host.home_for(name) or dir)
                for collection, spec in pairs(entry.mod.data or {}) do
                    host.collections.declare(name:lower(), collection:lower(), spec)
                end
                -- A config file people edit by hand needs to answer back when
                -- the edit is wrong; silence is how a typo becomes an evening.
                entry.problems = host.collections.problems(name:lower())
                for _, problem in ipairs(entry.problems) do
                    log(name .. ": " .. problem)
                end
            end
            if entry.ok then
                local events = 0
                for _ in pairs(entry.mod.on or {}) do events = events + 1 end
                log(string.format("loaded %s (%d handler(s), %d command(s))",
                    name, events, #framework.command_words(entry.mod)))
                for _, warning in ipairs(entry.warnings or {}) do
                    log(name .. ": " .. warning)
                end
            else
                log(string.format("%s failed: %s", name, entry.error))
            end
        end
    end

    if #framework.order == 0 then
        log("no mods found — a mod is a folder with a mod.lua beside " .. dir .. "/Palladium")
    end
    return #framework.order
end

function framework.command_words(mod)
    local words = {}
    for word in pairs(mod.commands or {}) do words[#words + 1] = word end
    table.sort(words)
    return words
end

-- ── dispatch ────────────────────────────────────────────────────────────────
-- Events are queued rather than delivered where they are published: publishing
-- happens inside an engine hook, and mod code has no business running there.
-- The action poll drains this, so a mod that blocks delays other mods and
-- nothing else.

function framework.enqueue(event_type, subject, data)
    if #framework.order == 0 then return end
    if #queue >= MAX_QUEUE then
        dropped = dropped + 1
        if dropped % 100 == 1 then log(string.format("event queue full — %d dropped", dropped)) end
        return
    end
    queue[#queue + 1] = { type = event_type, subject = subject, data = data or {} }
end

local function deliver(event)
    for _, name in ipairs(framework.order) do
        local entry = framework.mods[name]
        if entry.ok then
            local handler = entry.mod.on and entry.mod.on[event.type]
            if handler then
                local ok, err = pcall(handler, event, entry.pal)
                if not ok then
                    host.info(string.format("%s: %s handler failed: %s", name, event.type, tostring(err)))
                end
            end
        end
    end
    if event.type == "player.chat" then framework.chat(event) end
end

function framework.drain()
    if #queue == 0 then return 0 end
    local batch = queue
    queue = {}
    for _, event in ipairs(batch) do deliver(event) end
    return #batch
end

-- ── chat commands ───────────────────────────────────────────────────────────
-- Chat is untrusted: the first word is matched exactly, arguments are handed
-- over as a string and never interpreted here, and one command per player per
-- cooldown keeps a spamming client from driving the engine.

-- Every capability is also a command. `!pal.spawn species=Lamball level=20` is
-- the same call the HTTP door makes, gated by the same node — and those nodes
-- default to deny, so out of the box this is an admin surface and nothing
-- more. Parameters are key=value because that is what the action queue itself
-- carries; nothing here has to guess at positions.
local function builtin(event, word, rest)
    local action = word:sub(2)
    if not host.capabilities or not host.capabilities[action] then return false end

    local who = event.subject and event.subject.id or ""
    local params, target = {}, who
    for chunk in tostring(rest or ""):gmatch("%S+") do
        local key, value = chunk:match("^([%w_]+)=(.*)$")
        if key == "target" then target = value
        elseif key then params[key] = value end
    end

    -- Checked with the parameters, so "may spawn, but only Lamball" is
    -- enforced on the command and not merely written down.
    local allowed, _source, _where, violation =
        host.permissions and host.permissions:resolve(who, action, params)
    if not allowed then
        host.call("player.message", who, {
            text = violation and (word .. ": " .. violation) or ("You may not use " .. word .. "."),
        }, function() end)
        return true
    end

    host.call(action, target, params, function(ok, err)
        host.call("player.message", who, {
            text = ok and (word .. " ok") or (word .. " failed: " .. tostring(err)),
        }, function() end)
    end)
    return true
end

function framework.chat(event)
    local message = tostring(event.data and event.data.message or "")
    local word, rest = message:match("^%s*(%S+)%s*(.*)$")
    if not word then return false end
    word = word:lower()

    for _, name in ipairs(framework.order) do
        local entry = framework.mods[name]
        local command = entry.ok and entry.mod.commands and entry.mod.commands[word]
        if command then
            local who = event.subject and event.subject.id or ""
            local now = os.time()
            if now - (last_command[who] or 0) < COMMAND_COOLDOWN_S then return true end
            last_command[who] = now

            if command.node and not entry.pal.can(who, command.node) then
                entry.pal.message(who, "You are not allowed to use that.")
                return true
            end
            local ok, err = pcall(command.run, event, rest or "", entry.pal)
            if not ok then
                host.info(string.format("%s: %s failed: %s", name, word, tostring(err)))
            end
            return true
        end
    end

    -- A mod's own command wins over the built-in of the same name, so a mod
    -- can offer a friendlier `!spawn` without losing `!pal.spawn`.
    if word:sub(1, 1) == "!" then
        local who = event.subject and event.subject.id or ""
        local now = os.time()
        if now - (last_command[who] or 0) < COMMAND_COOLDOWN_S then return true end
        local handled = builtin(event, word, rest)
        if handled then last_command[who] = now end
        return handled
    end
    return false
end

-- ── the registry, as something outside the game can read ────────────────────
-- Palladium can write JSON but not read it, which decides the direction of
-- every file it shares: Lua reads Lua, everything else reads this.

function framework.snapshot()
    local parts = {}
    for _, name in ipairs(framework.order) do
        local entry = framework.mods[name]
        local mod = entry.mod or {}
        local nodes = {}
        for _, permission in ipairs(mod.permissions or {}) do
            nodes[#nodes + 1] = string.format('{"node":%s,"description":%s,"default":%s}',
                host.json_string(permission.node, 128),
                host.json_string(permission.description or "", 200),
                host.json_string(permission.default == "allow" and "allow" or "deny", 8))
        end
        local commands = {}
        for _, word in ipairs(framework.command_words(mod)) do
            commands[#commands + 1] = host.json_string(word, 32)
        end
        local events = {}
        for event_type in pairs(mod.on or {}) do events[#events + 1] = host.json_string(event_type, 48) end
        table.sort(events)
        local warnings = {}
        for _, warning in ipairs(entry.warnings or {}) do
            warnings[#warnings + 1] = host.json_string(warning, 200)
        end
        for _, problem in ipairs(entry.problems or {}) do
            warnings[#warnings + 1] = host.json_string(problem, 200)
        end

        parts[#parts + 1] = string.format(
            '{"name":%s,"version":%s,"api":%d,"description":%s,"ok":%s,"error":%s,' ..
            '"permissions":[%s],"commands":[%s],"events":[%s],"warnings":[%s]}',
            host.json_string(name, 64),
            host.json_string(tostring(mod.version or ""), 32),
            tonumber(mod.api) or API,
            host.json_string(tostring(mod.description or ""), 200),
            entry.ok and "true" or "false",
            entry.error and host.json_string(entry.error, 300) or "null",
            table.concat(nodes, ","), table.concat(commands, ","), table.concat(events, ","),
            table.concat(warnings, ","))
    end

    -- Collections ride along with the mods, so anything reading this snapshot
    -- knows what is stored, who owns it, what shape it is and where to edit it
    -- — without being taught about any particular mod.
    local stored = {}
    for _, c in ipairs(host.collections and host.collections.all() or {}) do
        local fields = {}
        for field, kind in pairs(c.fields or {}) do
            fields[#fields + 1] = host.json_string(field, 48) .. ":" .. host.json_string(kind, 24)
        end
        table.sort(fields)
        stored[#stored + 1] = string.format(
            '{"name":%s,"owner":%s,"description":%s,"storage":%s,"file":%s,"count":%d,"fields":{%s}}',
            host.json_string(c.qualified, 96), host.json_string(c.owner, 32),
            host.json_string(c.description or "", 200), host.json_string(c.storage, 8),
            c.file and host.json_string(c.file, 64) or "null",
            c.count, table.concat(fields, ","))
    end

    local body = string.format('{"at":%d,"agent":%s,"mods":[%s],"collections":[%s]}\n',
        os.time(), host.json_string(host.agent or "Palladium", 32),
        table.concat(parts, ","), table.concat(stored, ","))
    local path = host.root .. "/.state/palladium-mods.json"
    local file = io.open(path .. ".tmp", "w")
    if not file then
        log("cannot write the registry snapshot to " .. path)
        return false
    end
    file:write(body)
    file:close()
    os.remove(path)
    os.rename(path .. ".tmp", path)
    return true
end

function framework.init(options)
    for key, value in pairs(options or {}) do host[key] = value end
    return framework
end

return framework
