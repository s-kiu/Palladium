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

-- ── audit ───────────────────────────────────────────────────────────────────
-- Every write that reaches the engine from inside the game — a chat command
-- or a mod's own call — appends one line here. The panel's database already
-- audits the HTTP door; this file is the same trail for the two surfaces
-- that never pass through it. player.message is exempt: it changes nothing
-- and every greeting would drown the log.
local function audit(source, who, action, target, params)
    local spec = host.capabilities and host.capabilities[action]
    if type(spec) ~= "table" or spec.scope ~= "write" then return end
    if action == "player.message" then return end
    local parts = {}
    for key, value in pairs(params or {}) do
        parts[#parts + 1] = key .. "=" .. tostring(value)
    end
    table.sort(parts)
    local file = io.open((host.root or "/palworld") .. "/logs/bridge-audit.log", "a")
    if not file then return end
    file:write(string.format("%s\t%s\t%s\t%s\t%s\n",
        os.date("!%Y-%m-%dT%H:%M:%SZ"), source .. ":" .. (who or "-"), action,
        target or "-", table.concat(parts, " ")))
    file:close()
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

-- ── settings overlay ────────────────────────────────────────────────────────
-- A mod's settings table in mod.lua is the author's defaults; settings.config
-- beside the mod's data is the operator's word, and it survives mod updates.
-- Plain `key = value` lines; dotted keys reach into tables and numeric
-- segments make list positions:
--
--   announce = true
--   items.1.item = Money
--   items.1.count = 250
--
-- Any top-level key the file mentions replaces that default wholesale — a
-- half-merged list surprises everyone. true/false and numbers coerce,
-- everything else stays text. Re-read on the host's cadence, so tuning a
-- reward needs no restart; a mod that reads settings at use time sees the
-- new value, one that cached a local at load keeps the old until boot.

local function coerce(text)
    if text == "true" then return true end
    if text == "false" then return false end
    local number = tonumber(text)
    if number ~= nil then return number end
    return text
end

local function parse_settings(content)
    local overlay = {}
    for raw_line in (tostring(content) .. "\n"):gmatch("(.-)\n") do
        local line = raw_line:gsub("^%s+", ""):gsub("%s+$", "")
        if line ~= "" and line:sub(1, 1) ~= ";" and line:sub(1, 1) ~= "#" then
            local key, value = line:match("^([%w_%.]+)%s*=%s*(.*)$")
            if key then
                local node = overlay
                local segments = {}
                for segment in key:gmatch("[^%.]+") do segments[#segments + 1] = segment end
                for i = 1, #segments - 1 do
                    local seg = tonumber(segments[i]) or segments[i]
                    if type(node[seg]) ~= "table" then node[seg] = {} end
                    node = node[seg]
                end
                node[tonumber(segments[#segments]) or segments[#segments]] = coerce(value)
            end
        end
    end
    return overlay
end

local function settings_path(name)
    local home = host.home_for and host.home_for(name) or (host.mods_dir .. "/" .. name)
    return home .. "/settings.config"
end

-- A mod may ship a commented settings.example.config next to its code. On
-- the first load with no live settings.config, the example becomes it —
-- so a fresh install has a real file to open, already explaining itself.
-- Never re-copied: the moment an operator has a settings.config, updates
-- to the example are reference material, not overwrites.
local function seed_from_example(name, live, which)
    if exists(live) then return end
    local example = io.open(host.mods_dir .. "/" .. name .. "/" .. which .. ".example.config", "r")
    if not example then return end
    local content = example:read("a")
    example:close()
    local out = io.open(live, "w")
    if not out then return end
    out:write(content)
    out:close()
    log(name .. ": " .. which .. ".config created from the shipped example")
end

local function seed_settings(name)
    seed_from_example(name, settings_path(name), "settings")
end

-- A mod declares its permission nodes in mod.lua, which keeps a small mod one
-- file. A large one can move them out instead: a permissions.config beside the
-- mod declares the same nodes, and when that file is present it is the whole
-- truth — the table in mod.lua is not merged with it, so what an operator
-- reads in the file is what the mod owns. One section per node:
--
--   [bigmod.reward]
--   default = allow
--   description = earn the reward on a streak
--
-- Same shape as settings.config beside it: a shipped permissions.example.config
-- becomes the live file on first load, full-line `;` and `#` comments only,
-- and a line that makes no sense is named with its number rather than dropped
-- in silence.
local function parse_permissions(content)
    local list, problems, current = {}, {}, nil
    local lineno = 0
    for raw_line in (tostring(content) .. "\n"):gmatch("(.-)\n") do
        lineno = lineno + 1
        local line = raw_line:gsub("^%s+", ""):gsub("%s+$", "")
        if line ~= "" and line:sub(1, 1) ~= ";" and line:sub(1, 1) ~= "#" then
            local section = line:match("^%[%s*([^%]]-)%s*%]$")
            if section then
                current = { node = section:lower() }
                list[#list + 1] = current
            else
                local key, value = line:match("^([%w_]+)%s*=%s*(.*)$")
                if not key then
                    problems[#problems + 1] = string.format("line %d: not a [node] heading or key = value", lineno)
                elseif not current then
                    problems[#problems + 1] = string.format("line %d: %s before any [node] heading", lineno, key)
                elseif key:lower() == "default" or key:lower() == "description" then
                    current[key:lower()] = value:gsub("%s+$", "")
                else
                    problems[#problems + 1] = string.format('line %d: unknown key "%s" — expected default or description', lineno, key)
                end
            end
        end
    end
    return list, problems
end

-- The same rules a mod.lua declaration answers to: a mod owns its own
-- namespace and only its own, and a default is allow or deny.
local function usable_permissions(name, list)
    local prefix = name:lower() .. "."
    local kept, refused = {}, {}
    for _, entry in ipairs(list) do
        if type(entry.node) ~= "string" or entry.node == "" then
            refused[#refused + 1] = "a section with no node name"
        elseif entry.node:sub(1, #prefix) ~= prefix then
            refused[#refused + 1] = string.format('"%s" must start with "%s"', entry.node, prefix)
        elseif entry.default ~= nil and entry.default ~= "allow" and entry.default ~= "deny" then
            refused[#refused + 1] = string.format('"%s": default must be allow or deny', entry.node)
        else
            kept[#kept + 1] = entry
        end
    end
    return kept, refused
end

local function permissions_path(name)
    local home = host.home_for and host.home_for(name) or (host.mods_dir .. "/" .. name)
    return home .. "/permissions.config"
end

-- Whichever the operator can see wins: a permissions.config beside the mod
-- replaces the mod.lua table wholesale rather than adding to it, so there is
-- one place to read and no half-merged answer.
local function declared_permissions(name, mod)
    local file = io.open(permissions_path(name), "r")
    if not file then return mod.permissions or {}, false end
    local content = file:read("a")
    file:close()

    local parsed, problems = parse_permissions(content)
    for _, problem in ipairs(problems) do
        log(name .. ": permissions.config " .. problem)
    end
    local kept, refused = usable_permissions(name, parsed)
    for _, refusal in ipairs(refused) do
        log(name .. ": permissions.config refused " .. refusal)
    end
    log(string.format("%s: permissions.config declares %d node(s) — the mod.lua table is not read", name, #kept))
    return kept, true
end

local settings_seen = {} -- mod name → file content behind the current overlay

local function overlaid(name, defaults)
    local file = io.open(settings_path(name), "r")
    if not file then
        settings_seen[name] = nil
        return defaults or {}
    end
    local content = file:read("a")
    file:close()
    settings_seen[name] = content
    local merged = {}
    for key, value in pairs(defaults or {}) do merged[key] = value end
    local overridden = 0
    for key, value in pairs(parse_settings(content)) do
        merged[key] = value
        overridden = overridden + 1
    end
    if overridden > 0 then
        log(name .. ": settings.config overrides " .. overridden .. " key(s)")
    end
    return merged
end

function framework.reload_settings()
    for _, name in ipairs(framework.order) do
        local entry = framework.mods[name]
        if entry.ok and entry.pal then
            local file = io.open(settings_path(name), "r")
            local content = file and file:read("a") or nil
            if file then file:close() end
            if content ~= settings_seen[name] then
                entry.pal.settings = overlaid(name, entry.mod.settings)
            end
        end
    end
end

local function api_for(name, mod)
    local pal = {
        name = name,
        settings = overlaid(name, mod.settings),
    }

    function pal.log(text)
        host.info(name .. ": " .. tostring(text))
    end

    -- Every capability, by the manifest's own names. `done` is optional and
    -- receives (ok, err, data) — actions reach the engine on the game thread,
    -- so an answer is not available on return.
    function pal.call(action_type, userid, params, done)
        audit("mod:" .. name, nil, action_type, userid, params)
        host.call(action_type, userid or "", params or {}, function(ok, err, data)
            if not done then return end
            -- Results come back as the pairs the envelope is built from; a mod
            -- wants `data.count`, not `data[2][2]`.
            local fields = {}
            for _, pair in ipairs(data or {}) do fields[pair[1]] = pair[2] end
            local safe, failure = pcall(done, ok, err, fields)
            if not safe then host.info(name .. ": " .. action_type .. " callback failed: " .. tostring(failure)) end
        end)
    end

    function pal.message(userid, text, done)
        pal.call("player.message", userid, { text = text }, done)
    end

    -- The engine accepts a grant of an unknown item id and reports success
    -- having added nothing, so the count is read before and after: `done` is
    -- told whether the items arrived, not merely whether the call returned. A
    -- build that cannot answer the count is not an empty inventory, so an
    -- unanswerable check is taken as delivered rather than as a failure.
    -- The read-back this used to do itself now lives in the capability, so
    -- every surface gets a truthful answer and there is one way to give.
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
    local function open_collection(collection)
        if not host.collections then return nil end
        return host.collections.open(name:lower() .. "." .. tostring(collection):lower())
    end
    pal.data = open_collection

    -- Every capability under the name the manifest gives it: what chat calls
    -- `!give_item` and HTTP calls `player.give_item` is `pal.player.give_item`
    -- here, with the same parameters. Built from the generated table rather
    -- than written out, so a capability cannot exist under one name in one
    -- place and another name here, and a new one needs no code at all.
    --
    -- A capability that names someone takes the id first, one that names
    -- nobody starts at the parameters. Which is which is read from the call
    -- itself rather than from the manifest's target field: an id is always a
    -- string and parameters are always a table, so both shapes are safe, and
    -- a capability whose target is the world or the server needs no special
    -- case here to be callable the obvious way.
    for full in pairs(host.capabilities or {}) do
        local ns, verb = tostring(full):match("^([%w_]+)%.([%w_]+)$")
        if ns and verb then
            local group = pal[ns]
            if type(group) ~= "table" then group = {} end
            group[verb] = function(a, b, c)
                if type(a) == "table" then return pal.call(full, nil, a, b) end
                return pal.call(full, a, b, c)
            end
            pal[ns] = group
        end
    end

    -- `data` is both a capability namespace and this mod's own storage handle.
    -- One name, two meanings, so the table answers to a call as well as to an
    -- index: pal.data("homes") opens a collection, pal.data.list reads any.
    if type(pal.data) == "table" then
        setmetatable(pal.data, { __call = function(_, collection) return open_collection(collection) end })
    end

    -- Named once, warned once: these said the same thing as a capability under
    -- a different word, which is the drift this framework exists to prevent.
    local warned = {}
    local function moved(old, replacement, fn)
        return function(...)
            if not warned[old] then
                warned[old] = true
                host.info(string.format("%s: pal.%s is deprecated — use pal.%s (same call, the manifest's name)",
                    name, old, replacement))
            end
            return fn(...)
        end
    end
    pal.message = moved("message", "player.message", pal.message)
    pal.heal = moved("heal", "player.heal", pal.heal)
    pal.announce = moved("announce", "server.announce", pal.announce)
    pal.give = moved("give", "player.give_item", pal.give)

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
                        seed_settings(name)
                        seed_from_example(name, permissions_path(name), "permissions")
                        entry.permissions, entry.permissions_from_file = declared_permissions(name, result)
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
                host.permissions:register(name:lower(), entry.permissions or {})
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
-- carries; positional arguments are also accepted, matched to the declared
-- parameters by kind so `!pal.spawn IceDrake 25 [WorldTree_ATK]` reads
-- naturally. `@me` anywhere means the caller's own player id.

-- The short word after the group dot, kept only when no other capability
-- claims it: `!heal` is `!player.heal` because nothing else ends in heal,
-- while `!stats` stays ambiguous and requires the full name.
local aliases
local function alias_map()
    if aliases then return aliases end
    aliases = {}
    local counts = {}
    for action in pairs(host.capabilities or {}) do
        local short = action:match("%.(.+)$")
        if short then counts[short] = (counts[short] or 0) + 1 end
    end
    for action in pairs(host.capabilities or {}) do
        local short = action:match("%.(.+)$")
        if short and counts[short] == 1 then aliases[short] = action end
    end
    return aliases
end

local function resolve_action(word)
    if host.capabilities and host.capabilities[word] then return word end
    return alias_map()[word]
end

-- Tokens are whitespace-split; [brackets] hold one value whole. key=value
-- assigns by name. A bare token fills the first unset declared parameter
-- whose kind it can be: numbers seek int/number, true/false seek bool,
-- bracketed and other words seek string/item_id. `@me` becomes the caller;
-- any other `@Name` becomes the online player of that name, and names
-- nobody online — the third return — instead of guessing.
local function resolve_at(value, who)
    if value == "@me" then return who end
    local name = value:match("^@(.+)$")
    if not name then return nil end
    local id = host.player_by_name and host.player_by_name(name)
    if id then return id end
    return nil, "no player named " .. name .. " is online"
end

local function parse_args(action, rest, who)
    local spec = host.capabilities[action]
    local declared = type(spec) == "table" and spec.params or {}
    local params, target, targeted = {}, who, false
    local s, i = tostring(rest or ""), 1
    local tokens = {}
    while i <= #s do
        local a, b, bracketed = s:find("^%s*%[([^%]]*)%]", i)
        if a then
            tokens[#tokens + 1] = { value = bracketed, bracketed = true }
            i = b + 1
        else
            local a2, b2, word = s:find("^%s*(%S+)", i)
            if not a2 then break end
            tokens[#tokens + 1] = { value = word }
            i = b2 + 1
        end
    end
    local function next_unset(want)
        for _, p in ipairs(declared) do
            if params[p.name] == nil and want(p) then return p end
        end
    end
    local any = function() return true end
    for _, token in ipairs(tokens) do
        local value = token.value
        local key, named
        if not token.bracketed then key, named = value:match("^([%w_]+)=(.*)$") end
        if key then
            if named:sub(1, 1) == "@" then
                local id, trouble = resolve_at(named, who)
                if trouble then return nil, nil, trouble end
                named = id or named
            end
            if key == "target" then target, targeted = named, true else params[key] = named end
        elseif not token.bracketed and value:sub(1, 1) == "@" and #value > 1 then
            local id, trouble = resolve_at(value, who)
            if trouble then return nil, nil, trouble end
            target, targeted = id, true
        else
            local slot
            if token.bracketed then
                slot = next_unset(function(p) return p.kind == "string" end) or next_unset(any)
            elseif value == "true" or value == "false" then
                slot = next_unset(function(p) return p.kind == "bool" end) or next_unset(any)
            elseif tonumber(value) then
                slot = next_unset(function(p) return p.kind == "int" or p.kind == "number" end)
                    or next_unset(any)
            else
                slot = next_unset(function(p) return p.kind == "item_id" or p.kind == "string" end)
                    or next_unset(any)
            end
            if slot then params[slot.name] = value end
        end
    end
    return params, target, nil, targeted
end

local function builtin(event, word, rest)
    local action = resolve_action(word:sub(2))
    if not action then return false end

    local who = event.subject and event.subject.id or ""
    local params, target, trouble, targeted = parse_args(action, rest, who)
    if trouble then
        host.call("player.message", who, { text = word .. ": " .. trouble }, function() end)
        return true
    end

    -- Chat sugar with one beneficiary today: "!teleport @Name" reads as
    -- "take me to them", so a named player with no other destination becomes
    -- the to= and the caller is the one who moves.
    if action == "player.teleport" and targeted
        and params.x == nil and params.to == nil then
        params.to = target
        target = who
    end

    -- Checked with the parameters, so "may spawn, but only Lamball" is
    -- enforced on the command and not merely written down. The target rides
    -- along, spelled @me when it is the caller — the resolver derives the
    -- target's standing from it, so "only yourself" and "only below your
    -- rank" grants hold here exactly as they do on every other surface.
    local gated = { target = (target == who) and "@me" or target }
    for key, value in pairs(params) do gated[key] = value end
    local allowed, _source, _where, violation
    if host.permissions then
        allowed, _source, _where, violation = host.permissions:resolve(who, action, gated)
    end
    if not allowed then
        host.call("player.message", who, {
            text = violation and (word .. ": " .. violation) or ("You may not use " .. word .. "."),
        }, function() end)
        return true
    end

    audit("chat", who, action, target, params)
    host.call(action, target, params, function(ok, err, data)
        -- "!position ok" alone answers nothing: the result's plain fields
        -- ride along, capped so a long one cannot flood the chat line.
        local text
        if ok then
            local bits = {}
            for _, pair in ipairs(data or {}) do
                local value = pair[2]
                if type(value) ~= "table" and value ~= nil and value ~= "" then
                    bits[#bits + 1] = pair[1] .. "=" .. tostring(value)
                end
            end
            text = word .. " ok"
            if #bits > 0 then
                local summary = table.concat(bits, " ")
                if #summary > 300 then summary = summary:sub(1, 297) .. "..." end
                text = text .. ": " .. summary
            end
        else
            text = word .. " failed: " .. tostring(err)
        end
        host.call("player.message", who, { text = text }, function() end)
    end)
    return true
end

local function say(who, text)
    host.call("player.message", who, { text = text }, function() end)
end

-- The shortest word that reaches a capability: its alias when one exists,
-- the full name otherwise.
local function word_for(action)
    for short, full in pairs(alias_map()) do
        if full == action then return short end
    end
    return action
end

-- `!commands`: every chat word the caller may actually use — mod commands
-- through their nodes, capabilities through the same permission resolve the
-- call itself would face. Chunked to respect the chat message limit.
local function list_commands(event)
    local who = event.subject and event.subject.id or ""
    local words = {}
    for _, name in ipairs(framework.order) do
        local entry = framework.mods[name]
        if entry.ok then
            for word, command in pairs(entry.mod.commands or {}) do
                if not command.node or entry.pal.can(who, command.node) then
                    words[#words + 1] = word
                end
            end
        end
    end
    local actions = {}
    for action in pairs(host.capabilities or {}) do
        -- Self-use is the case tested, so a grant narrowed to `target = @me`
        -- or to a target rank still lists — the caller may use that word on
        -- themselves.
        if host.permissions and host.permissions:resolve(who, action, { target = "@me" }) then
            actions[#actions + 1] = "!" .. word_for(action)
        end
    end
    table.sort(words)
    table.sort(actions)
    for _, extra in ipairs(actions) do words[#words + 1] = extra end
    if #words == 0 then
        say(who, "Nothing is enabled for you.")
        return
    end
    local line = "You can use:"
    for _, word in ipairs(words) do
        if #line + #word + 1 > 400 then
            say(who, line)
            line = word
        else
            line = line .. " " .. word
        end
    end
    say(who, line)
    say(who, "?<command> shows parameters. @me is your own player id.")
end

-- `?<command>`: the declared parameters, spoken. Required ones in <angle>,
-- optional in [square], kinds and ranges on a second line.
local function help(event, word)
    local who = event.subject and event.subject.id or ""
    local name = word:sub(2):gsub("^!", "")
    if name == "" then
        say(who, "?<command> explains a command; !commands lists what you may use.")
        return
    end
    for _, mod_name in ipairs(framework.order) do
        local entry = framework.mods[mod_name]
        local command = entry.ok and entry.mod.commands and entry.mod.commands["!" .. name]
        if command then
            say(who, command.help or ("!" .. name .. " — a command from " .. mod_name .. "."))
            return
        end
    end
    local action = resolve_action(name)
    if not action then
        say(who, "No such command. !commands lists what you may use.")
        return
    end
    local spec = host.capabilities[action]
    spec = type(spec) == "table" and spec or {}
    local shape, detail = {}, {}
    for _, p in ipairs(spec.params or {}) do
        shape[#shape + 1] = p.required and ("<" .. p.name .. ">") or ("[" .. p.name .. "]")
        local bit = p.name .. ": " .. (p.kind or "string")
        if p.min or p.max then bit = bit .. " " .. tostring(p.min or "?") .. ".." .. tostring(p.max or "?") end
        if p.default ~= nil then bit = bit .. " (default " .. tostring(p.default) .. ")" end
        detail[#detail + 1] = bit
    end
    say(who, "!" .. word_for(action) .. " " .. table.concat(shape, " "))
    if #detail > 0 then
        local line = table.concat(detail, "; ")
        if #line > 480 then line = line:sub(1, 477) .. "..." end
        say(who, line)
    end
    if (spec.target or "") == "player" then
        say(who, "Targets you unless you aim it: @Name for an online player, or target=<id>. Values by position or key=value; @me works.")
    end
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
    local who = event.subject and event.subject.id or ""
    local now = os.time()
    if word == "!commands" or word == "!help" then
        if now - (last_command[who] or 0) < COMMAND_COOLDOWN_S then return true end
        last_command[who] = now
        list_commands(event)
        return true
    end
    if word:sub(1, 1) == "?" and #word > 1 then
        if now - (last_command[who] or 0) < COMMAND_COOLDOWN_S then return true end
        last_command[who] = now
        help(event, word)
        return true
    end
    if word:sub(1, 1) == "!" then
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
        for _, permission in ipairs(entry.permissions or mod.permissions or {}) do
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
    aliases = nil -- capabilities may have changed; the alias map follows them
    return framework
end

return framework
