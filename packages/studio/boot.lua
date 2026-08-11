-- Boots Palladium's real permission engine against the in-memory filesystem
-- and answers questions about it. This file is the whole trick of the studio:
-- nothing in here decides who may do what — the same store.lua, collections.lua,
-- permissions.lua and framework.lua that run on servers are loaded verbatim
-- (the copies in engine/ are generated, drift-checked ones) and asked.
--
-- Two globals must exist before this chunk runs, because it is executed the
-- same way by both hosts — dofile under Lua 5.4 in the tests, a fengari
-- dostring in the browser:
--
--   MEMFS            the filesystem stand-in (memfs.lua)
--   STUDIO_SOURCES   name → Lua source text for store, collections,
--                    permissions, framework, capabilities
--
-- It defines one global, studio(request) → JSON text. Requests are
-- tab-separated key=value — the bridge's own action format, because a parser
-- this codebase already trusts beats a second one.

local MODS_DIR = "/Mods"
local HOME = MODS_DIR .. "/Palladium"
-- One folder per owner, the framework included — the same layout a server
-- keeps, so a file taken from here goes straight back where it came from.
local OWN = HOME .. "/mods/Palladium"
local CONFIG = OWN .. "/permissions.config"

-- ── JSON out ─────────────────────────────────────────────────────────────────
-- Encoding only: requests arrive as key=value, so nothing here ever parses
-- JSON. Arrays are explicit — a table is an object unless marked — because
-- guessing from table shape turns an empty list into an empty object.

local ARRAY = {}

local function array(t)
    return setmetatable(t or {}, ARRAY)
end

local ESCAPES = {
    ["\\"] = "\\\\", ['"'] = '\\"', ["\n"] = "\\n",
    ["\r"] = "\\r", ["\t"] = "\\t",
}

local function json(value)
    local kind = type(value)
    if kind == "nil" then return "null" end
    if kind == "boolean" then return value and "true" or "false" end
    if kind == "number" then
        if value ~= value or value == math.huge or value == -math.huge then return "null" end
        if math.floor(value) == value then return string.format("%d", value) end
        return string.format("%.10g", value)
    end
    if kind == "string" then
        return '"' .. value:gsub('[%z\1-\31\\"]', function(c)
            return ESCAPES[c] or string.format("\\u%04x", c:byte())
        end) .. '"'
    end
    if kind == "table" then
        if getmetatable(value) == ARRAY then
            local parts = {}
            for _, item in ipairs(value) do parts[#parts + 1] = json(item) end
            return "[" .. table.concat(parts, ",") .. "]"
        end
        local keys = {}
        for key in pairs(value) do keys[#keys + 1] = tostring(key) end
        table.sort(keys)
        local parts = {}
        for _, key in ipairs(keys) do
            parts[#parts + 1] = json(key) .. ":" .. json(value[key])
        end
        return "{" .. table.concat(parts, ",") .. "}"
    end
    return "null"
end

-- ── engine lifecycle ─────────────────────────────────────────────────────────

local ENGINE = { "store", "collections", "permissions", "framework", "capabilities" }

local state = nil        -- everything about the currently booted engine
local pending = {}       -- Palladium-home files staged for the next boot: name → text
local pending_mods = {}  -- mod name → { [filename] = text } — whole mod folders
-- Config files to put back verbatim before the engine reads anything: how a
-- read-only question un-does its scaffolding without also un-doing an edit.
-- They must be in place before framework.load(), because that is when a mod
-- registers its nodes and an existing file is what stops it resetting them.
local pending_homes = {}
local sim_players = {}   -- id → { name, groups = {...} } — simulator-only people

local function fresh_modules()
    for _, name in ipairs(ENGINE) do
        package.loaded[name] = nil
        local source = STUDIO_SOURCES[name]
        if not source then error("missing engine source: " .. name) end
        package.preload[name] = assert(load(source, "@" .. name .. ".lua"))
    end
end

local function boot()
    MEMFS.wipe()
    MEMFS.install()
    fresh_modules()

    for name, text in pairs(pending) do
        MEMFS.write(OWN .. "/" .. name, text)
    end

    -- Staged mods land exactly where a server keeps them: one folder each,
    -- named in mods.list. A list file wins over probing, so discovery never
    -- reaches for io.popen — and with no mods staged, it honestly finds none.
    local mod_names = {}
    for name in pairs(pending_mods) do mod_names[#mod_names + 1] = name end
    table.sort(mod_names)
    for _, name in ipairs(mod_names) do
        for file, text in pairs(pending_mods[name]) do
            MEMFS.write(MODS_DIR .. "/" .. name .. "/" .. file, text)
        end
    end
    MEMFS.write(HOME .. "/mods.list",
        "; studio — the staged mods, loaded like a server loads them\n"
        .. table.concat(mod_names, "\n") .. "\n")

    for path, text in pairs(pending_homes) do MEMFS.write(path, text) end

    local logs = {}
    local function info(text) logs[#logs + 1] = tostring(text) end

    local Store = require("store")
    local Collections = require("collections")
    local Permissions = require("permissions")
    local framework = require("framework")
    local CAPS = require("capabilities")

    Collections.init({ root = "/Pal", info = info })
    -- Groups and grants span every mod and belong to none, so they live with
    -- the framework rather than with a mod. Home is enough — the permissions
    -- file and the records are both in it.
    Collections.home("bridge", OWN)

    local perms = Permissions.new(Collections)
    -- The same call a server makes at boot: seeds the five tiers on a virgin
    -- state and touches nothing once any operator-shaped group exists.
    perms:seed_tiers()

    local sent, called = {}, {}
    framework.init({
        capabilities = CAPS.actions,
        collections = Collections,
        permissions = perms,
        store = Store,
        tags = Collections.declare("bridge", "tags", { fields = { value = "string" } }),
        info = info,
        call = function(action, userid, params, report)
            called[#called + 1] = { type = action, userid = userid, params = params }
            if action == "player.message" then
                sent[#sent + 1] = { to = tostring(userid or ""), text = tostring(params and params.text or "") }
            end
            report(true, nil, {})
        end,
        root = "/Pal",
        mods_dir = MODS_DIR,
        -- The same layout a server keeps: a mod's own files live under
        -- Palladium, not in the folder it was installed from.
        home_for = function(name) return HOME .. "/mods/" .. name end,
        json_string = function(value, limit)
            local text = tostring(value or ""):gsub('[%c"\\]', " ")
            return '"' .. text:sub(1, limit or 64) .. '"'
        end,
        agent = "Palladium",
        event_types = { ["player.chat"] = true, ["player.join"] = true },
        player_by_name = function(name)
            local wanted = tostring(name or ""):lower()
            for id, player in pairs(sim_players) do
                if tostring(player.name or ""):lower() == wanted then return id end
            end
            return nil
        end,
    })
    framework.load()

    -- A live server hands over its per-mod node files without the mod.lua
    -- that declares them. Adopt those folders anyway, so the studio shows and
    -- edits the same inventory the server has rather than a central slice of
    -- it. A mod that did load already owns its home and is left alone.
    local prefix = HOME .. "/mods/"
    local adopted = {}
    for path in pairs(pending_homes) do
        if path:sub(1, #prefix) == prefix then
            local folder = path:sub(#prefix + 1):match("^([^/]+)/settings%.config$")
            if folder and not framework.mods[folder] then
                Collections.home(folder, prefix .. folder)
                perms:nodes_of(folder:lower())
                adopted[#adopted + 1] = folder
            end
        end
    end
    table.sort(adopted)

    state = {
        perms = perms,
        framework = framework,
        collections = Collections,
        caps = CAPS,
        adopted = adopted,
        logs = logs,
        sent = sent,
        called = called,
    }
end

local function need_state()
    if not state then error("nothing is loaded — boot first") end
    return state
end

-- Re-boot from exactly what is on disk right now: the way every read-only
-- question un-does its scaffolding (matrix rows, simulated players) without
-- trusting itself to clean up piece by piece.
local function central_text()
    return MEMFS.read(CONFIG) or ""
end

-- Every config the engine holds, keyed by path. A mod's node defaults live in
-- its own file now, so capturing the central one alone would throw an edit
-- away on the next question asked.
local function snapshot()
    local files = {}
    for _, path in ipairs(MEMFS.list()) do
        if path:sub(-7) == ".config" then files[path] = MEMFS.read(path) end
    end
    return files
end

-- Every config the engine wrote, not just the central one: a mod's nodes live
-- in its own folder now, so a download that carried the central file alone
-- would quietly drop an edit to any of them.
local function config_files()
    local out = array({})
    for _, path in ipairs(MEMFS.list()) do
        if path:sub(-7) == ".config" then
            out[#out + 1] = {
                path = path,
                -- What an operator has to write it back as, relative to the
                -- folder Palladium lives in.
                name = path:match("/Mods/(.+)$") or path,
                text = MEMFS.read(path) or "",
            }
        end
    end
    return out
end

local function restore(files)
    pending_homes = files
    boot()
end

-- ── questions ────────────────────────────────────────────────────────────────

local function problems()
    local s = need_state()
    local out = array({})
    for _, problem in ipairs(s.collections.problems("bridge") or {}) do
        out[#out + 1] = tostring(problem)
    end
    -- What the file parser cannot see: rules that read as rules and are not,
    -- and entries that are never reached. The server logs the same list.
    for _, problem in ipairs(s.perms:lint()) do
        out[#out + 1] = tostring(problem)
    end
    return out
end

local function group_rows()
    local s = need_state()
    local rows = {}
    for name, record in pairs(s.perms:groups()) do
        rows[#rows + 1] = {
            name = name,
            weight = tonumber(record.weight) or 0,
            tag = record.tag or "",
            is_default = record.is_default == "true",
        }
    end
    table.sort(rows, function(a, b)
        if a.weight ~= b.weight then return a.weight > b.weight end
        return a.name < b.name
    end)
    return rows
end

local function node_rows()
    local s = need_state()
    local seen, rows = {}, {}
    for id, record in pairs(s.perms:nodes()) do
        seen[id] = true
        rows[#rows + 1] = {
            id = id,
            default = record.default == "allow" and "allow" or "deny",
            description = record.description or "",
            capability = s.caps.actions[id] ~= nil,
        }
    end
    for id in pairs(s.caps.actions) do
        if not seen[id] then
            rows[#rows + 1] = { id = id, default = "deny", description = "", capability = true }
        end
    end
    table.sort(rows, function(a, b) return a.id < b.id end)
    return rows
end

-- Every player the config itself names — memberships or overrides. These are
-- the people a lens can be pointed at without inventing anybody.
local function player_rows()
    local s = need_state()
    local rows = {}
    for id in pairs(s.perms.players_c:all()) do
        local names = {}
        for _, group in ipairs(s.perms:groups_of(id)) do names[#names + 1] = group.name end
        rows[#rows + 1] = {
            id = id,
            groups = table.concat(names, ", "),
            overrides = #s.perms:user_entries(id),
        }
    end
    table.sort(rows, function(a, b) return a.id < b.id end)
    return rows
end

-- The staged mods as the framework judged them: loaded with their commands,
-- or refused with the same reason a server would log.
local function mod_rows()
    local s = need_state()
    local rows = array({})
    for _, name in ipairs(s.framework.order) do
        local entry = s.framework.mods[name]
        local commands = array({})
        if entry.ok then
            for _, word in ipairs(s.framework.command_words(entry.mod)) do
                local spec = entry.mod.commands[word]
                commands[#commands + 1] = {
                    word = word,
                    help = type(spec) == "table" and tostring(spec.help or "") or "",
                    node = type(spec) == "table" and tostring(spec.node or "") or "",
                }
            end
        end
        local troubles = array({})
        for _, warning in ipairs(entry.warnings or {}) do troubles[#troubles + 1] = warning end
        for _, problem in ipairs(entry.problems or {}) do troubles[#troubles + 1] = problem end
        rows[#rows + 1] = {
            name = name,
            ok = entry.ok and true or false,
            error = entry.error and tostring(entry.error) or "",
            commands = commands,
            troubles = troubles,
        }
    end
    return rows
end

local function info_reply()
    local groups = array({})
    for _, row in ipairs(group_rows()) do groups[#groups + 1] = row end
    local nodes = array({})
    for _, row in ipairs(node_rows()) do nodes[#nodes + 1] = row end
    local players = array({})
    for _, row in ipairs(player_rows()) do players[#players + 1] = row end
    local logs = array({})
    for _, line in ipairs(need_state().logs) do logs[#logs + 1] = line end
    return {
        ok = true,
        groups = groups,
        nodes = nodes,
        players = players,
        mods = mod_rows(),
        problems = problems(),
        logs = logs,
        config = central_text(),
        files = config_files(),
    }
end

-- One ephemeral player per group, resolved twice per node: once bare, once as
-- a self-targeted call. The pair separates "may" from "may, but only on
-- themselves" — the third state a two-state matrix lies about.
local function matrix_reply()
    local s = need_state()
    local before = snapshot()
    local groups = group_rows()
    local nodes = node_rows()

    local cells = {}
    for _, group in ipairs(groups) do
        local uid = "F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0"
        if not group.is_default then s.perms:assign(uid, group.name) end
        local column = {}
        for _, node in ipairs(nodes) do
            local bare, source, where, violation = s.perms:resolve(uid, node.id, {})
            local self_ok = bare
            if not bare then
                self_ok = (s.perms:resolve(uid, node.id, { target = "@me" }))
            end
            -- A violation on the bare probe is the resolver's own word that an
            -- allow entry matched and its constraint did not hold — which is a
            -- different answer from "denied", and the matrix must not collapse
            -- the two. A deny entry produces no violation, ever.
            column[node.id] = {
                allowed = bare and true or false,
                self = self_ok and true or false,
                conditional = (not bare and not self_ok and violation ~= nil) or false,
                source = tostring(source or ""),
                where = where and tostring(where) or "",
                why = violation and tostring(violation) or "",
            }
        end
        cells[group.name] = column
        if not group.is_default then s.perms:unassign(uid, group.name) end
    end

    restore(before)

    local group_list = array({})
    for _, row in ipairs(groups) do group_list[#group_list + 1] = row end
    local node_list = array({})
    for _, row in ipairs(nodes) do node_list[#node_list + 1] = row end
    return { ok = true, groups = group_list, nodes = node_list, cells = cells }
end

local function simulate_reply(actor, line)
    local s = need_state()
    local before = snapshot()

    for id, player in pairs(sim_players) do
        for _, group in ipairs(player.groups) do
            s.perms:assign(id, group)
        end
    end

    for i = #s.sent, 1, -1 do s.sent[i] = nil end
    for i = #s.called, 1, -1 do s.called[i] = nil end

    -- Past the per-player command cooldown, without waiting it out.
    MEMFS.skip(5)

    local actor_name = (sim_players[actor] and sim_players[actor].name) or actor
    local handled = s.framework.chat({
        type = "player.chat",
        subject = { kind = "player", id = actor, name = actor_name },
        data = { message = line },
    })

    local messages = array({})
    for _, message in ipairs(s.sent) do
        messages[#messages + 1] = { to = message.to, text = message.text }
    end
    local executed = nil
    for _, call in ipairs(s.called) do
        if call.type ~= "player.message" then
            local params = {}
            for key, value in pairs(call.params or {}) do params[key] = tostring(value) end
            executed = { action = call.type, target = tostring(call.userid or ""), params = params }
            break
        end
    end

    restore(before)
    return {
        ok = true,
        handled = handled and true or false,
        messages = messages,
        executed = executed,
    }
end

-- ── overview ────────────────────────────────────────────────────────────────
-- What is installed, whether each mod's folder is whole, and what it declares.
-- The question this answers is "is anything wrong", so a mod that failed says
-- why and a file that is missing is named.
local function overview_reply()
    local s = need_state()
    local rows = array({})
    for _, name in ipairs(s.framework.order) do
        local entry = s.framework.mods[name]
        local home = HOME .. "/mods/" .. name

        local files = array({})
        for _, file in ipairs({ "settings.config", "generated/commands.ref", ".data" }) do
            local text = MEMFS.read(home .. "/" .. file)
            files[#files + 1] = {
                name = file,
                present = text ~= nil,
                bytes = text and #text or 0,
            }
        end

        local troubles = array({})
        if not entry.ok then troubles[#troubles + 1] = tostring(entry.error) end
        for _, warning in ipairs(entry.warnings or {}) do troubles[#troubles + 1] = warning end
        for _, problem in ipairs(entry.problems or {}) do troubles[#troubles + 1] = problem end

        local counts = { commands = 0, events = 0, nodes = 0, collections = 0 }
        if entry.ok then
            counts.commands = #s.framework.command_words(entry.mod)
            for _ in pairs(entry.mod.on or {}) do counts.events = counts.events + 1 end
            counts.nodes = #(entry.permissions or {})
            for _ in pairs(entry.mod.data or {}) do counts.collections = counts.collections + 1 end
        end

        rows[#rows + 1] = {
            name = name,
            ok = entry.ok and true or false,
            code = true,
            version = entry.ok and tostring(entry.mod.version or "") or "",
            description = entry.ok and tostring(entry.mod.description or "") or "",
            files = files,
            troubles = troubles,
            counts = counts,
        }
    end

    -- A live server hands over each mod's settings.config but not its mod.lua,
    -- so the framework loads none of them. They are still installed, and their
    -- settings and nodes are still editable here — saying "no mods" because the
    -- code is out of reach would be a lie about the server.
    for _, folder in ipairs(s.adopted or {}) do
        local home = HOME .. "/mods/" .. folder
        local files = array({})
        for _, file in ipairs({ "settings.config", "generated/commands.ref", ".data" }) do
            local text = MEMFS.read(home .. "/" .. file)
            files[#files + 1] = { name = file, present = text ~= nil, bytes = text and #text or 0 }
        end
        local held = s.perms:nodes_of(folder:lower())
        local nodes = 0
        for _ in pairs(held:all()) do nodes = nodes + 1 end
        rows[#rows + 1] = {
            name = folder,
            ok = true,
            code = false,
            version = "",
            description = "Installed on the server. Its code is not here, so its commands and "
                .. "events cannot be shown — its settings and permission nodes can.",
            files = files,
            troubles = array({}),
            counts = { commands = 0, events = 0, nodes = nodes, collections = 0 },
        }
    end
    return { ok = true, mods = rows, problems = problems(), logs = (function()
        local out = array({})
        for _, line in ipairs(s.logs) do out[#out + 1] = line end
        return out
    end)() }
end

-- ── data ────────────────────────────────────────────────────────────────────
-- Every declared collection and everything in it, read only. This is what a
-- mod has remembered; nothing here writes.
local function data_reply()
    local s = need_state()
    local out = array({})
    for _, spec in ipairs(s.collections.all() or {}) do
        local handle = s.collections.open(spec.qualified)
        local records = array({})
        if handle then
            local ids = {}
            for id in pairs(handle:all()) do ids[#ids + 1] = id end
            table.sort(ids)
            for _, id in ipairs(ids) do
                local fields = array({})
                local record = handle:all()[id]
                local keys = {}
                for key in pairs(record) do keys[#keys + 1] = key end
                table.sort(keys)
                for _, key in ipairs(keys) do
                    local value = record[key]
                    if type(value) == "table" then value = table.concat(value, ", ") end
                    fields[#fields + 1] = { key = key, value = tostring(value) }
                end
                records[#records + 1] = { id = id, fields = fields }
            end
        end
        out[#out + 1] = {
            name = spec.qualified,
            owner = spec.owner,
            description = tostring(spec.description or ""),
            storage = spec.storage,
            count = #records,
            records = records,
        }
    end
    return { ok = true, collections = out }
end

-- ── commands ────────────────────────────────────────────────────────────────
-- Every word a player can type: the mods' own, and every capability, each with
-- what it takes. Read-only — the shape comes from the mod and the manifest.
local function commands_reply()
    local s = need_state()
    local out = array({})

    for _, name in ipairs(s.framework.order) do
        local entry = s.framework.mods[name]
        if entry.ok then
            for _, word in ipairs(s.framework.command_words(entry.mod)) do
                local command = entry.mod.commands[word]
                local params = array({})
                for _, p in ipairs(command.params or {}) do
                    params[#params + 1] = {
                        name = tostring(p.name), kind = tostring(p.kind or "string"),
                        required = p.required and true or false,
                        min = p.min, max = p.max,
                        default = p.default ~= nil and tostring(p.default) or nil,
                    }
                end
                out[#out + 1] = {
                    word = word,
                    source = name,
                    kind = "mod",
                    node = tostring(command.node or ""),
                    help = tostring(command.help or ""),
                    target = command.target and tostring(command.target) or nil,
                    params = params,
                    declared = command.params ~= nil,
                }
            end
        end
    end

    for action, spec in pairs(s.caps.actions) do
        local params = array({})
        for _, p in ipairs(type(spec) == "table" and spec.params or {}) do
            params[#params + 1] = {
                name = tostring(p.name), kind = tostring(p.kind or "string"),
                required = p.required and true or false,
                min = p.min, max = p.max,
                default = p.default ~= nil and tostring(p.default) or nil,
            }
        end
        out[#out + 1] = {
            word = "!" .. action,
            source = "Palladium",
            kind = "capability",
            node = action,
            help = "",
            target = type(spec) == "table" and spec.target or nil,
            params = params,
            declared = true,
        }
    end

    table.sort(out, function(a, b)
        if a.kind ~= b.kind then return a.kind == "mod" end
        return a.word < b.word
    end)
    return { ok = true, commands = out }
end

-- ── settings ────────────────────────────────────────────────────────────────
-- What each mod's settings are now, and what its author's defaults were. The
-- values live above the first section of the mod's settings.config.
local function settings_of(name)
    local text = MEMFS.read(HOME .. "/mods/" .. name .. "/settings.config") or ""
    local values, order = {}, {}
    for line in (text .. "\n"):gmatch("([^\n]*)\n") do
        if line:match("^%s*%[") then break end
        local key, value = line:match("^%s*([%w_%.]+)%s*=%s*(.-)%s*$")
        if key then
            if values[key] == nil then order[#order + 1] = key end
            values[key] = value
        end
    end
    return values, order
end

local function settings_reply()
    local s = need_state()
    local out = array({})
    for _, name in ipairs(s.framework.order) do
        local entry = s.framework.mods[name]
        if entry.ok then
            local values, order = settings_of(name)
            local rows = array({})
            local seen = {}
            for _, key in ipairs(order) do
                seen[key] = true
                local author = (entry.mod.settings or {})[key]
                rows[#rows + 1] = {
                    key = key,
                    value = values[key],
                    author = author ~= nil and tostring(author) or nil,
                    overridden = author == nil or tostring(author) ~= values[key],
                }
            end
            -- A default the operator has never written down is still a setting.
            local defaults = {}
            for key in pairs(entry.mod.settings or {}) do defaults[#defaults + 1] = key end
            table.sort(defaults)
            for _, key in ipairs(defaults) do
                if not seen[key] then
                    rows[#rows + 1] = {
                        key = key,
                        value = tostring((entry.mod.settings or {})[key]),
                        author = tostring((entry.mod.settings or {})[key]),
                        overridden = false,
                    }
                end
            end
            if #rows > 0 then
                out[#out + 1] = { mod = name, settings = rows }
            end
        end
    end

    -- A mod installed on the server whose code is not here still has a
    -- settings.config, and every value in it is still the operator's to change.
    -- With no mod.lua there is no author's default to compare against, so each
    -- row is simply what the file says.
    for _, folder in ipairs(s.adopted or {}) do
        local values, order = settings_of(folder)
        local rows = array({})
        for _, key in ipairs(order) do
            rows[#rows + 1] = { key = key, value = values[key], author = nil, overridden = true }
        end
        if #rows > 0 then
            out[#out + 1] = { mod = folder, settings = rows }
        end
    end
    return { ok = true, mods = out }
end

-- ── the one entry point ──────────────────────────────────────────────────────

local function parse_request(text)
    local fields = {}
    for chunk in tostring(text or ""):gmatch("[^\t]+") do
        local key, value = chunk:match("^([%w_]+)=(.*)$")
        if key then fields[key] = value end
    end
    return fields
end

local OPS = {}

function OPS.reset()
    pending = {}
    pending_mods = {}
    pending_homes = {}
    state = nil
    return { ok = true }
end

-- Stage one file of one mod. The name must be the folder name a server would
-- use — the framework itself refuses a mod whose declared name disagrees.
function OPS.mod(request)
    local name = tostring(request.name or ""):match("^[%w_%.%-]+$")
    if not name then return { ok = false, error = "mod needs a plain folder name" } end
    local file = tostring(request.file or "mod.lua")
    if file:find("/", 1, true) or file:find("\\", 1, true) then
        return { ok = false, error = "mod files are flat: mod.lua, settings.config, permissions.config" }
    end
    pending_mods[name] = pending_mods[name] or {}
    pending_mods[name][file] = tostring(request.text or ""):gsub("\r\n", "\n"):gsub("\r", "\n")
    return { ok = true }
end

function OPS.file(request)
    local name = request.name or "permissions.config"
    -- Provider file managers and Windows clients love CRLF; the engine's
    -- parser wants lines. Normalised once, on the way in.
    pending[name] = tostring(request.text or ""):gsub("\r\n", "\n"):gsub("\r", "\n")
    return { ok = true }
end

-- One mod's own permission file, staged into the folder the engine reads it
-- from. Separate from OPS.mod, which stages what a mod folder ships.
function OPS.home_file(request)
    local name = tostring(request.name or ""):match("^[%w_%.%-]+$")
    if not name then return { ok = false, error = "home_file needs a plain mod folder name" } end
    pending_homes[HOME .. "/mods/" .. name .. "/settings.config"] =
        tostring(request.text or ""):gsub("\r\n", "\n"):gsub("\r", "\n")
    return { ok = true }
end

function OPS.boot()
    boot()
    return info_reply()
end

function OPS.info()
    return info_reply()
end

function OPS.matrix()
    return matrix_reply()
end

function OPS.overview()
    return overview_reply()
end

function OPS.data()
    return data_reply()
end

function OPS.commands()
    return commands_reply()
end

function OPS.settings()
    return settings_reply()
end

-- One setting, written back into the preamble of that mod's settings.config.
-- The rest of the file — the operator's comments, and the [nodes] section
-- below — is left exactly as it was.
function OPS.set_setting(request)
    need_state()
    local mod = tostring(request.mod or ""):match("^[%w_%.%-]+$")
    local key = tostring(request.key or ""):match("^[%w_%.]+$")
    if not mod or not key then
        return { ok = false, error = "set_setting needs a mod folder and a plain key" }
    end
    local path = HOME .. "/mods/" .. mod .. "/settings.config"
    local text = MEMFS.read(path)
    if text == nil then return { ok = false, error = "no settings.config for " .. mod } end
    local value = tostring(request.value or "")

    local out = {}
    for line in (text .. "\n"):gmatch("([^\n]*)\n") do out[#out + 1] = line end

    -- Where the settings end. Not simply "above the first section": the
    -- comment describing that section sits between the two, and a value
    -- written below it would be read back as part of the comment block and
    -- duplicated on the next rewrite.
    local limit = #out
    for index, line in ipairs(out) do
        if line:match("^%s*%[") then limit = index - 1 break end
    end
    while limit > 0 and (out[limit]:match("^%s*$") or out[limit]:match("^%s*;")) do
        limit = limit - 1
    end

    local pattern = "^%s*" .. key:gsub("([%.%-%%])", "%%%1") .. "%s*="
    local replaced = false
    for index = 1, limit do
        if out[index]:match(pattern) then
            out[index] = key .. " = " .. value
            replaced = true
            break
        end
    end
    if not replaced then table.insert(out, limit + 1, key .. " = " .. value) end

    -- Written through the staging map so the next boot reads it, the way every
    -- other edit here survives the re-boot a question causes.
    local body = table.concat(out, "\n"):gsub("\n+$", "\n")
    MEMFS.write(path, body)
    pending_homes[path] = body
    return { ok = true, file = "Palladium/mods/" .. mod .. "/settings.config", mod = mod }
end

function OPS.player(request)
    local id = tostring(request.id or "")
    if id == "" then return { ok = false, error = "player needs an id" } end
    local groups = {}
    for name in tostring(request.groups or ""):gmatch("[^,%s]+") do
        groups[#groups + 1] = name
    end
    sim_players[id] = { name = tostring(request.name or id), groups = groups }
    return { ok = true }
end

function OPS.forget_players()
    sim_players = {}
    return { ok = true }
end

function OPS.simulate(request)
    local actor = tostring(request.actor or "")
    if actor == "" then return { ok = false, error = "simulate needs an actor" } end
    return simulate_reply(actor, tostring(request.line or ""))
end

-- One player, every node: their overrides, then their groups by weight, then
-- the default group, then the node default — the resolver's own order, asked
-- per node. A real id from the config is a pure read; a simulated player gets
-- their groups for the duration and the file put back after.
function OPS.lens(request)
    local s = need_state()
    local id = tostring(request.player or "")
    if id == "" then return { ok = false, error = "lens needs a player" } end

    local simulated = sim_players[id]
    local before = nil
    if simulated then
        before = snapshot()
        for _, group in ipairs(simulated.groups) do s.perms:assign(id, group) end
    end

    local rows = array({})
    for _, node in ipairs(node_rows()) do
        local bare, source, where, violation = s.perms:resolve(id, node.id, {})
        local self_ok = bare
        if not bare then
            self_ok = (s.perms:resolve(id, node.id, { target = "@me" }))
        end
        rows[#rows + 1] = {
            id = node.id,
            allowed = bare and true or false,
            self = self_ok and true or false,
            conditional = (not bare and not self_ok and violation ~= nil) or false,
            source = tostring(source or ""),
            where = where and tostring(where) or "",
            why = violation and tostring(violation) or "",
        }
    end

    local standing_group, standing_weight = s.perms:standing(id)
    local groups = array({})
    for _, group in ipairs(s.perms:groups_of(id)) do
        groups[#groups + 1] = { name = group.name, weight = group.weight }
    end
    local overrides = array({})
    for _, entry in ipairs(s.perms:user_entries(id)) do
        overrides[#overrides + 1] = {
            node = entry.node,
            effect = entry.effect,
            where = entry.where or "",
            until_stamp = entry.until_stamp or "",
        }
    end

    if before then restore(before) end
    return {
        ok = true,
        player = simulated and simulated.name or id,
        simulated = simulated ~= nil,
        standing = standing_group,
        weight = standing_weight,
        groups = groups,
        overrides = overrides,
        rows = rows,
    }
end

function OPS.render()
    need_state()
    return { ok = true, config = central_text(), files = config_files() }
end

-- Edits go through the same API the panel and the agent use, and persist:
-- collections rewrites the file the moment anything changes it, so render()
-- afterwards is already the downloadable answer.

function OPS.set_default(request)
    local s = need_state()
    local node = tostring(request.node or ""):lower()
    if node == "" then return { ok = false, error = "set_default needs a node" } end
    -- Into the file that owns the node, not the central one: writing a mod's
    -- node centrally would leave two copies of it disagreeing.
    local held = s.perms:nodes_of(s.perms.owner_of(node))
    local existing = held:get(node)
    held:set(node, {
        default = request.effect == "allow" and "allow" or "deny",
        description = (existing and existing.description) or "",
    })

    -- Which file it landed in, so a live caller writes that one back rather
    -- than the central file it did not touch.
    local owner, folder = s.perms.owner_of(node), nil
    if held ~= s.perms.nodes_c then
        local prefix = HOME .. "/mods/"
        for _, path in ipairs(MEMFS.list()) do
            if path:sub(1, #prefix) == prefix then
                local candidate = path:sub(#prefix + 1):match("^([^/]+)/settings%.config$")
                if candidate and candidate:lower() == owner then folder = candidate end
            end
        end
    end
    return {
        ok = true,
        mod = folder,
        file = folder and ("Palladium/mods/" .. folder .. "/settings.config")
            or "Palladium/permissions.config",
    }
end

function OPS.entry(request)
    local s = need_state()
    if request.effect ~= "allow" and request.effect ~= "deny" then
        return { ok = false, error = "entry needs effect=allow or effect=deny" }
    end
    local ok, err = s.perms:group_set_entry(
        tostring(request.group or ""), tostring(request.node or ""),
        request.effect, request.where, request.until_stamp)
    return { ok = ok and true or false, error = err }
end

function OPS.entry_remove(request)
    local s = need_state()
    local ok, err = s.perms:group_remove_entry(
        tostring(request.group or ""), tostring(request.node or ""))
    return { ok = ok and true or false, error = err }
end

function OPS.grant(request)
    local s = need_state()
    if request.effect ~= "allow" and request.effect ~= "deny" then
        return { ok = false, error = "grant needs effect=allow or effect=deny" }
    end
    local ok, err = s.perms:grant(
        tostring(request.player or ""), tostring(request.node or ""),
        request.effect, request.where, request.until_stamp)
    return { ok = ok and true or false, error = err }
end

function OPS.revoke(request)
    local s = need_state()
    local ok = s.perms:revoke(tostring(request.player or ""), tostring(request.node or ""))
    return { ok = ok and true or false }
end

function OPS.group_new(request)
    local s = need_state()
    local ok, err = s.perms:group_create(
        tostring(request.name or ""), request.tag, tonumber(request.weight) or 0)
    return { ok = ok and true or false, error = err }
end

function OPS.group_update(request)
    local s = need_state()
    local ok, err = s.perms:group_update(
        tostring(request.name or ""), request.tag, tonumber(request.weight))
    return { ok = ok and true or false, error = err }
end

function OPS.group_delete(request)
    local s = need_state()
    local ok, err = s.perms:group_delete(tostring(request.name or ""))
    return { ok = ok and true or false, error = err }
end

function OPS.assign(request)
    local s = need_state()
    local ok, err = s.perms:assign(tostring(request.player or ""), tostring(request.group or ""))
    return { ok = ok and true or false, error = err }
end

function OPS.unassign(request)
    local s = need_state()
    local ok = s.perms:unassign(tostring(request.player or ""), tostring(request.group or ""))
    return { ok = ok and true or false }
end

function studio(request_text)
    local request = parse_request(request_text)
    local op = OPS[tostring(request.op or "")]
    if not op then
        return json({ ok = false, error = "unknown op: " .. tostring(request.op) })
    end
    local ok, reply = pcall(op, request)
    if not ok then
        return json({ ok = false, error = tostring(reply) })
    end
    return json(reply)
end
