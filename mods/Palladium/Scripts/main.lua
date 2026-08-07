-- Palladium — the in-game half of the pal-up bridge.
--
-- Publishes engine events onto the shared volume as JSON lines, and executes
-- actions handed to it the same way. UE4SS Lua has no sockets, so files on the
-- volume are the only transport in either direction.
--
--   out: /palworld/logs/bridge-events.jsonl    JSON envelope, one per line
--   in:  /palworld/.state/bridge-actions.jsonl tab-separated key=value lines
--
-- Both files are emptied by serve.sh at boot; offsets are per-run.
--
-- Envelope v2 — every line is {v, at, kind, type, subject?, data}; results add
-- id, ok, error. Which events exist and what parameters actions take is NOT
-- decided here: Scripts/generated/capabilities.lua is generated from
-- packages/shared/bridge-capabilities.json, and this file only implements
-- handlers for what that table declares. Engine hook names live in the
-- manifest too, so a game patch is a manifest edit, not a code hunt.
--
-- Rules that keep the game alive, learned the hard way:
--   - native (/Script/) hook targets only: Blueprint targets fault the process
--   - never StaticFindObject a UFunction path: same fault
--   - never write a hook parameter (param:set faults mid-broadcast)
--   - resolve engine objects immediately before use: a reference does not
--     survive intervening engine work
--   - reflection decides whether a function exists, but only named shapes with
--     known signatures are ever called: a discovered name called blind faults
--   - everything runs under pcall; a bridge bug drops an event, never the game

local MOD = "Palladium"
local VERSION = "4.9.3"

local CAPS = require("generated/capabilities")
local framework = require("framework")
local Store = require("store")
local Collections = require("collections")
local Permissions = require("permissions")

local MODS_DIR, MODS_DIR_SOURCE = Store.mods_dir(debug.getinfo(1, "S").source)

local PAL_ROOT, ROOT_SOURCE = Store.resolve_root()
local EVENT_FILE = PAL_ROOT .. "/logs/bridge-events.jsonl"
local ACTION_FILE = PAL_ROOT .. "/.state/bridge-actions.jsonl"

local MAX_TEXT = 512
local HOOK_RETRY_MS = 2000
local HOOK_RETRY_LIMIT = 15
local ACTION_POLL_MS = 500
local JOIN_DEDUP_SECONDS = 30
local NPC_EVENTS_PER_SECOND = 20

local function info(text)
    print(string.format("[%s] %s\n", MOD, text))
end

local function guard(what, fn, ...)
    local ok, err = pcall(fn, ...)
    if not ok then
        info(string.format("%s failed: %s", what, tostring(err)))
    end
    return ok
end

Store.ensure_dir(PAL_ROOT .. "/logs")
Store.ensure_dir(PAL_ROOT .. "/.state")

-- Where a mod's own files go. On pal-up the loader reads an rsync mirror, so
-- the originals — the folders somebody actually dropped mods into — are named
-- explicitly rather than guessed at; writing to the mirror would be undone on
-- the next boot.
local MODS_SOURCE = Store.mods_source()
local function home_for(folder)
    return (MODS_SOURCE or MODS_DIR) .. "/" .. folder
end

Collections.init({ root = PAL_ROOT, info = info, home_for = home_for })
Collections.home("bridge", home_for(MOD))
local perms = Permissions.new(Collections)
perms:seed_tiers()

-- Who has been here, so `firstEver` survives a reboot. A collection like any
-- other, kept beside Palladium itself.
local registry = Collections.declare("bridge", "registry", {
    description = "every player this server has seen, and how often",
    fields = { name = "string", first = "int", last = "int", joins = "int" },
})

-- Tags are not a special case any more: they are the collection every mod gets
-- for free, namespaced per mod so two can both keep a "count".
local tags = Collections.declare("bridge", "tags", {
    description = "per-player values mods keep — the persistence primitive",
    fields = { uid = "player", key = "string", value = "string" },
})

local locations = Collections.declare("bridge", "locations", {
    description = "named places worth returning to, and the arenas the world announced",
    fields = { x = "number", y = "number", z = "number", source = "string", species = "string" },
})

local species_seen = Collections.declare("bridge", "species", {
    description = "pal species this world has actually spawned, with the levels they came at",
    fields = { min_level = "int", max_level = "int", count = "int", rare = "bool", last_at = "int" },
})

-- Playtime is counted, not derived: once a minute, every present player's
-- record gains a minute. A crash costs at most the minute in progress, and
-- no session arithmetic can drift.
local playtime = Collections.declare("bridge", "playtime", {
    description = "minutes each player has actually spent on this server",
    fields = { name = "string", minutes = "int", last_seen = "int" },
})

-- → firstEver, firstSeen, joins
local function record_join(userid, name, now)
    if userid == "" then return false, now, 1 end
    local player = registry:get(userid)
    local joins = (player and tonumber(player.joins) or 0) + 1
    local first = player and tonumber(player.first) or now
    registry:set(userid, { name = name, first = first, last = now, joins = joins })
    return player == nil, first, joins
end

-- ── JSON ────────────────────────────────────────────────────────────────────
local ESCAPES = {
    ['"'] = '\\"', ["\\"] = "\\\\", ["\b"] = "\\b", ["\f"] = "\\f",
    ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t",
}

local function json_string(value, limit)
    local text = tostring(value or "")
    if #text > (limit or MAX_TEXT) then
        text = text:sub(1, limit or MAX_TEXT)
    end
    text = text:gsub('[%c"\\]', function(c)
        return ESCAPES[c] or string.format("\\u%04x", c:byte())
    end)
    return '"' .. text .. '"'
end

-- Values in data pairs: strings, numbers, booleans, or {raw=<json>} for a
-- pre-encoded object (a nested subject).
local function json_value(value)
    local kind = type(value)
    if kind == "boolean" then return value and "true" or "false" end
    if kind == "number" then
        if value % 1 == 0 then return string.format("%d", value) end
        return string.format("%.6g", value)
    end
    if kind == "table" and value.raw then return value.raw end
    return json_string(value)
end

local function json_pairs(fields)
    local parts = {}
    for _, field in ipairs(fields or {}) do
        if field[2] ~= nil then
            parts[#parts + 1] = json_string(field[1], 32) .. ":" .. json_value(field[2])
        end
    end
    return table.concat(parts, ",")
end

-- ── event file ──────────────────────────────────────────────────────────────
local function append_line(line)
    local file, err = io.open(EVENT_FILE, "a")
    if not file then
        error(string.format("cannot open %s: %s", EVENT_FILE, tostring(err)), 0)
    end
    file:write(line)
    file:close()
end

local function emit(kind, event_type, subject_json, data_fields, extra_fields)
    local parts = {
        '{"v":', tostring(CAPS.envelope),
        ',"at":', string.format("%d", os.time()),
        ',"kind":', json_string(kind, 16),
        ',"type":', json_string(event_type, 48),
    }
    local extra = json_pairs(extra_fields)
    if extra ~= "" then parts[#parts + 1] = "," .. extra end
    if subject_json then
        parts[#parts + 1] = ',"subject":' .. subject_json
    end
    parts[#parts + 1] = ',"data":{' .. json_pairs(data_fields) .. "}}\n"
    append_line(table.concat(parts))
end

-- `subject` is the same subject as a Lua table, for mods loaded into this
-- state. It is separate from the JSON because nothing here can read JSON back.
local function publish(event_type, subject_json, data_fields, subject)
    guard("emit " .. event_type, emit, "event", event_type, subject_json, data_fields)
    -- Mods see the event off the engine thread: this only queues, and the
    -- action poll delivers, so a slow handler cannot stall a hook.
    local data = {}
    for _, pair in ipairs(data_fields or {}) do data[pair[1]] = pair[2] end
    framework.enqueue(event_type, subject, data)
end

local function publish_result(id, action_type, ok, err, subject_json, data_fields)
    guard("emit result", emit, "result", action_type, subject_json, data_fields, {
        { "id", id }, { "ok", ok == true }, { "error", err },
    })
end

-- ── engine value extraction ─────────────────────────────────────────────────
local function unwrap(param)
    if param == nil then return nil end
    local ok, value = pcall(function() return param:get() end)
    if ok then return value end
    return param
end

local function member(value, name)
    local ok, field = pcall(function() return value[name] end)
    if ok then return field end
    return nil
end

local function valid(object)
    if object == nil then return false end
    local ok, is_valid = pcall(function() return object:IsValid() end)
    return ok and is_valid == true
end

local function to_text(value)
    if value == nil then return nil end
    if type(value) == "string" then return value end
    local ok, text = pcall(function() return value:ToString() end)
    if ok and type(text) == "string" and text ~= "" then return text end
    return nil
end

local function player_name(state)
    return (state and to_text(member(state, "PlayerNamePrivate"))) or "Unknown"
end

-- ── engine reflection ───────────────────────────────────────────────────────
-- This loader maps only a subset of the game's functions, and which subset
-- differs between builds: a missing function errors at the call site, and a
-- struct the loader does not map exposes nothing at all. Asking the class chain
-- what it declares turns both into data — a handler calls only shapes that are
-- there, and names what does exist when none of them fit.
local MAX_CLASS_DEPTH = 12
local class_functions = {}  -- class full name → { [function name] = true }
local class_properties = {} -- class full name → { [property name] = true }

local function class_of(object)
    if object == nil then return nil end
    local ok, class = pcall(function() return object:GetClass() end)
    if ok and valid(class) then return class end
    return nil
end

local function class_name(object)
    local class = class_of(object)
    if class == nil then return nil end
    local ok, name = pcall(function() return class:GetFullName() end)
    if ok and type(name) == "string" and name ~= "" then return name end
    return nil
end

-- Walks the class chain collecting whatever the visitor reports. Functions and
-- properties are two separate questions with the same answer shape, and a value
-- the engine keeps in a field rather than behind a getter is invisible to the
-- first one — which is the whole reason both exist here.
local function walk_class(object, visit)
    local names = {}
    local struct = class_of(object)
    for _ = 1, MAX_CLASS_DEPTH do
        if not valid(struct) then break end
        local current = struct
        pcall(function()
            visit(current, function(entry)
                local ok, name = pcall(function() return entry:GetFName():ToString() end)
                if ok and type(name) == "string" and name ~= "" then names[name] = true end
            end)
        end)
        local ok, super = pcall(function() return current:GetSuperStruct() end)
        if not ok or not valid(super) then break end
        struct = super
    end
    return names
end

local function functions_of(object)
    local key = class_name(object)
    if key and class_functions[key] then return class_functions[key] end
    local names = walk_class(object, function(struct, collect) struct:ForEachFunction(collect) end)
    if key then class_functions[key] = names end
    return names
end

local function properties_of(object)
    local key = class_name(object)
    if key and class_properties[key] then return class_properties[key] end
    local names = walk_class(object, function(struct, collect) struct:ForEachProperty(collect) end)
    if key then class_properties[key] = names end
    return names
end

-- A name set as a sorted list, narrowed to those containing a fragment.
local function matching(names, fragment, limit)
    local out = {}
    for name in pairs(names) do
        if fragment == "" or name:lower():find(fragment, 1, true) then out[#out + 1] = name end
    end
    table.sort(out)
    local total = #out
    while limit and #out > limit do table.remove(out) end
    return out, total
end

-- No functions at all means reflection did not answer for this object, not
-- that the object has none: an unanswered question falls back to attempting
-- the call, which is how this agent worked before the class chain was
-- readable. A guarded attempt is the cost; a silently dead handler is not.
local function declares(object, name)
    if object == nil then return false end
    local known = functions_of(object)
    if next(known) == nil then return true end
    return known[name] == true
end

-- What this build has in the neighbourhood of a name, so a failure can say so.
-- Properties count: a field is as good an answer as a getter when the question
-- is "where does this build keep the thing".
local MAX_CANDIDATES = 10

local function candidates(object, fragment, with_properties)
    local names = functions_of(object)
    if with_properties then
        local merged = {}
        for name in pairs(names) do merged[name] = true end
        for name in pairs(properties_of(object)) do merged[name] = true end
        names = merged
    end
    return (matching(names, fragment, MAX_CANDIDATES))
end

-- Calls the first shape whose function the holder declares. Each shape is
-- { holder, "FunctionName", invoke }; the name is what gets checked and
-- reported, the closure is the one signature that goes with it.
local function call_shapes(shapes)
    local tried = {}
    for _, shape in ipairs(shapes) do
        if declares(shape[1], shape[2]) then
            local ok, err = pcall(shape[3])
            if ok then return true, shape[2], tried end
            tried[#tried + 1] = shape[2] .. " -> " .. tostring(err)
        end
    end
    return false, nil, tried
end

-- PlayerUId as 32 hex digits — byte-identical to the REST API's playerId. The
-- words read back signed; the modulo undoes the sign extension.
local ZERO_UID = string.rep("0", 32)

local function hex32(word)
    return string.format("%08X", (word or 0) % 0x100000000)
end

local function player_userid(state)
    if state == nil then return "" end
    local uid = member(state, "PlayerUId")
    if uid == nil then return "" end
    local ok, text = pcall(function()
        return hex32(uid.A) .. hex32(uid.B) .. hex32(uid.C) .. hex32(uid.D)
    end)
    if ok and text and text ~= ZERO_UID then return text end
    return ""
end

local function guid_hex(guid)
    if guid == nil then return "" end
    local ok, text = pcall(function()
        return hex32(guid.A) .. hex32(guid.B) .. hex32(guid.C) .. hex32(guid.D)
    end)
    if ok and text and text ~= ZERO_UID then return text end
    return ""
end

-- A pal's stable identity: CharacterParameterComponent → IndividualParameter →
-- IndividualId.InstanceId. Every step probed — shapes move between builds.
local function pal_parameter(character)
    local component = member(character, "CharacterParameterComponent")
    if not valid(component) then return nil end
    local parameter = member(component, "IndividualParameter")
    if valid(parameter) then return parameter end
    local ok, got = pcall(function() return component:GetIndividualParameter() end)
    if ok and valid(got) then return got end
    return nil
end

local function pal_id_of(parameter)
    if parameter == nil then return "" end
    local individual = member(parameter, "IndividualId")
    if individual == nil then return "" end
    return guid_hex(member(individual, "InstanceId"))
end

local function state_of(character)
    local state = member(character, "PlayerState")
    if valid(state) then return state end
    return nil
end

-- ── subjects ────────────────────────────────────────────────────────────────
local function position_json(location)
    if type(location) ~= "table" and type(location) ~= "userdata" then return nil end
    local x, y, z = member(location, "X"), member(location, "Y"), member(location, "Z")
    if type(x) ~= "number" then return nil end
    return string.format(',"position":{"x":%.1f,"y":%.1f,"z":%.1f}', x, y or 0, z or 0)
end

-- The role is the tag of a player's highest-weight group, and it is attached
-- here because this is the process that can answer it — the panel used to add
-- it from a database it no longer owns.
local function role_of(userid)
    if not perms or userid == "" then return nil end
    local ok, tag = pcall(function() return perms:role(userid) end)
    return ok and tag or nil
end

local function player_subject(state)
    local userid = player_userid(state)
    local role = role_of(userid)
    return '{"kind":"player","id":' .. json_string(userid, 64)
        .. ',"name":' .. json_string(player_name(state), 64)
        .. (role and (',"role":' .. json_string(role, 32)) or "") .. "}"
end

local function subject_of(state)
    local userid = player_userid(state)
    return { kind = "player", id = userid, name = player_name(state), role = role_of(userid) }
end

local function pal_subject(species, location, pal_id)
    local id = (pal_id and pal_id ~= "") and (',"id":' .. json_string(pal_id, 64)) or ""
    local pos = location and position_json(location) or ""
    return '{"kind":"pal"' .. id .. ',"name":' .. json_string(species, 64) .. (pos or "") .. "}"
end

local BRIDGE_SUBJECT = '{"kind":"bridge","id":"' .. MOD .. '"}'

-- ── session tracking ────────────────────────────────────────────────────────
-- The character-init hook fires on connect AND on respawn after death. The
-- agent has seen the death, so: death arms a respawn flag; an init with the
-- flag set is a respawn; an init shortly after another is engine noise; the
-- rest are joins.
local online = {}            -- userid → last event epoch
local seen_this_run = {}     -- userid → true
local expecting_respawn = {} -- userid → true after a death

-- Leaving is the one thing the engine will not announce: no native disconnect
-- exists on this loader, and a Blueprint hook faults the process rather than
-- failing. So the agent watches who is still in the world instead.
--
-- A player has to be missing from two consecutive scans before it counts. One
-- empty result is a level transition or a bad moment to ask, not an empty
-- server, and announcing that everybody left is the kind of mistake a mod acts
-- on.
local LEAVE_SCAN_MS = 2000
local LEAVE_MISSES = 2
local present = {}  -- userid → name, as of the last scan
local missing = {}  -- userid → consecutive scans not seen
local session_start = {}  -- userid → epoch of the current session's first sighting

-- @Name in chat resolves against the players the leave scan already tracks:
-- engine-free at command time, at most one scan interval stale.
local function player_by_name(wanted)
    wanted = tostring(wanted or ""):lower()
    if wanted == "" then return nil end
    for userid, name in pairs(present) do
        if tostring(name):lower() == wanted then return userid end
    end
    return nil
end

local function scan_for_leaves()
    local ok, states = pcall(FindAllOf, "PalPlayerState")
    if not ok or type(states) ~= "table" then return end -- asking failed; nobody left

    local seen = {}
    for _, state in ipairs(states) do
        if valid(state) then
            local userid = player_userid(state)
            if userid ~= "" then seen[userid] = player_name(state) end
        end
    end

    for userid, name in pairs(seen) do
        present[userid] = name
        missing[userid] = nil
        if session_start[userid] == nil then session_start[userid] = os.time() end
    end

    for userid, name in pairs(present) do
        if seen[userid] == nil then
            local misses = (missing[userid] or 0) + 1
            missing[userid] = misses
            if misses >= LEAVE_MISSES then
                present[userid] = nil
                missing[userid] = nil
                session_start[userid] = nil
                -- A rejoin has to read as a join, not get deduplicated away as
                -- engine noise from the session that just ended.
                online[userid] = nil
                expecting_respawn[userid] = nil
                publish("player.leave",
                    '{"kind":"player","id":' .. json_string(userid, 64)
                        .. ',"name":' .. json_string(name, 64) .. "}",
                    { { "source", "agent" } },
                    { kind = "player", id = userid, name = name })
            end
        end
    end
end

-- Engine-free: `present` is plain data, so this can run off the game thread.
local function credit_playtime()
    local now = os.time()
    for userid, name in pairs(present) do
        local record = playtime:get(userid)
        local before = record and tonumber(record.minutes) or 0
        local minutes = before + 1
        playtime:set(userid, { name = name, minutes = minutes, last_seen = now })
        -- A completed hour of play is an event: a mod rewards playtime by
        -- subscribing, without owning a counter — or a loop — of its own.
        if math.floor(minutes / 60) > math.floor(before / 60) then
            publish("player.hour",
                '{"kind":"player","id":' .. json_string(userid, 64)
                    .. ',"name":' .. json_string(name, 64) .. "}",
                { { "hours", math.floor(minutes / 60) }, { "minutes", minutes } },
                { kind = "player", id = userid, name = name })
        end
    end
end

-- Real time is worth an event too: mods cannot own a loop, so the agent
-- tells them when the wall-clock minute turns (server-local time). "Every
-- Friday at 18:00" is then a mod comparing fields, not running a scheduler.
local WEEKDAYS = { "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday" }
local clock_last, clock_last_date

local function publish_clock()
    local now = os.date("*t")
    local stamp = string.format("%04d-%02d-%02dT%02d:%02d",
        now.year, now.month, now.day, now.hour, now.min)
    if stamp == clock_last then return end
    clock_last = stamp
    local date = string.format("%04d-%02d-%02d", now.year, now.month, now.day)
    publish("clock.minute", '{"kind":"server"}', {
        { "date", date },
        { "weekday", WEEKDAYS[now.wday] },
        { "hour", now.hour },
        { "minute", now.min },
    }, { kind = "server" })
    -- The day turning is its own event; a boot mid-day is not a turn, which
    -- is what the baseline check is for.
    if clock_last_date and date ~= clock_last_date then
        publish("clock.day", '{"kind":"server"}', {
            { "date", date },
            { "weekday", WEEKDAYS[now.wday] },
        }, { kind = "server" })
    end
    clock_last_date = date
end

-- ── hook handlers ───────────────────────────────────────────────────────────
local MESSAGE_FIELDS = { "Message", "message", "Text", "ChatMessage" }
local reported_chat_shape = false

local function chat_text(payload)
    local direct = to_text(payload)
    if direct then return direct end
    for _, field in ipairs(MESSAGE_FIELDS) do
        local text = to_text(member(payload, field))
        if text then return text end
    end
    return nil
end

local function on_chat(context, first, second)
    local controller = unwrap(context)
    local payload = unwrap(first)
    local message = chat_text(payload) or chat_text(unwrap(second))
    if not message or message == "" then
        if not reported_chat_shape then
            reported_chat_shape = true
            info(string.format(
                "chat hook fired but no text found (payload type: %s) — event dropped",
                type(payload)))
        end
        return
    end
    local state = state_of(controller)
    publish("player.chat", player_subject(state), { { "message", message } }, subject_of(state))
end

local function on_character_init(context)
    local character = unwrap(context)
    if not valid(character) then return end
    local state = state_of(character)
    if not state then
        -- PlayerState attaches a moment after the character initialises.
        if type(ExecuteWithDelay) == "function" then
            ExecuteWithDelay(50, function() guard("join retry", on_character_init, context) end)
        end
        return
    end

    local userid = player_userid(state)
    local now = os.time()

    if expecting_respawn[userid] then
        expecting_respawn[userid] = nil
        online[userid] = now
        publish("player.respawn", player_subject(state), {}, subject_of(state))
        return
    end
    if online[userid] and (now - online[userid]) < JOIN_DEDUP_SECONDS then
        online[userid] = now
        return
    end

    online[userid] = now
    -- firstEver comes from the registry, not from this run: the event file is
    -- emptied every boot, so nothing in it can answer "have they ever been
    -- here" on its own.
    -- Tracked from the join rather than waiting for the next scan, so a player
    -- who joins and leaves inside one scan window still produces a leave.
    present[userid] = player_name(state)
    missing[userid] = nil

    local first_ever, first_seen, joins = record_join(userid, player_name(state), now)
    publish("player.join", player_subject(state), {
        { "firstThisRun", seen_this_run[userid] == nil },
        { "firstEver", first_ever },
        { "firstSeen", first_seen },
        { "joins", joins },
    }, subject_of(state))
    seen_this_run[userid] = true
end

local function on_death(_, event)
    local dead_info = unwrap(event)
    if dead_info == nil then return end
    local victim = member(dead_info, "SelfActor")
    if not valid(victim) then return end
    -- Pals die constantly; only characters carrying a PlayerState are players.
    local victim_state = state_of(victim)
    if not victim_state then return end

    local userid = player_userid(victim_state)
    expecting_respawn[userid] = true

    local data = {}
    local attacker = member(dead_info, "LastAttacker")
    if valid(attacker) then
        local ok, controller = pcall(GetOwnerController, attacker)
        if ok and valid(controller) then
            local killer_state = member(controller, "PlayerState")
            if valid(killer_state) then
                data[#data + 1] = { "killer", { raw = player_subject(killer_state) } }
            end
        end
    end
    publish("player.death", player_subject(victim_state), data, subject_of(victim_state))
end

-- Fires for every character parameter init near players — the world spawning.
-- Player characters are filtered by their empty CharacterID / IsPlayer flag,
-- and the whole thing is throttled: on a busy server this is the loudest hook.
local npc_bucket, npc_bucket_count = 0, 0

local function on_param_init(context)
    local component = unwrap(context)
    if component == nil then return end
    local parameter = member(component, "IndividualParameter")
    if not valid(parameter) then return end
    local save = member(parameter, "SaveParameter")
    if save == nil then return end
    if member(save, "IsPlayer") == true then return end
    local species = to_text(member(save, "CharacterID"))
    if not species or species == "None" or species == "" then return end

    local now = os.time()
    if now ~= npc_bucket then
        npc_bucket, npc_bucket_count = now, 0
    end
    npc_bucket_count = npc_bucket_count + 1
    if npc_bucket_count > NPC_EVENTS_PER_SECOND then return end

    local location = nil
    local owner_ok, owner = pcall(function() return component:GetOwner() end)
    if owner_ok and valid(owner) then
        local loc_ok, loc = pcall(function() return owner:K2_GetActorLocation() end)
        if loc_ok then location = loc end
    end

    local level = member(save, "Level")
    local at_level = type(level) == "number" and level or 0
    local rare = member(save, "IsRarePal") == true

    -- What this world actually spawns, so a picker can offer the species that
    -- exist here rather than the whole datamined list.
    local seen = species_seen:get(species)
    species_seen:set(species, {
        min_level = math.min(tonumber(seen and seen.min_level) or at_level, at_level),
        max_level = math.max(tonumber(seen and seen.max_level) or at_level, at_level),
        count = (tonumber(seen and seen.count) or 0) + 1,
        rare = (rare or (seen and seen.rare == "true")) and "true" or "false",
        last_at = os.time(),
    })

    -- Boss-shaped spawns become teleport targets: the world announces where
    -- its arenas are, and nobody has to type coordinates in.
    if location and species:match("^BOSS_") or species:match("^Boss_")
        or species:match("^RAID_") or species:match("^GYM_") then
        local x, y, z = member(location, "X"), member(location, "Y"), member(location, "Z")
        if type(x) == "number" then
            locations:set("Boss: " .. species, {
                x = x, y = y or 0, z = z or 0, source = "boss", species = species,
            })
        end
    end

    publish("npc.spawn", pal_subject(species, location, pal_id_of(parameter)), {
        { "species", species },
        { "level", type(level) == "number" and level or 0 },
        { "rare", member(save, "IsRarePal") == true },
    }, { kind = "pal", id = pal_id_of(parameter), name = species })
end

-- ── action parameter validation (specs come from the generated table) ───────
local function validate(specs, raw)
    local out = {}
    for _, spec in ipairs(specs or {}) do
        local value = raw[spec.name]
        if value == nil or value == "" then
            if spec.required then return nil, "invalid_params: missing " .. spec.name end
            value = spec.default
        end
        if value ~= nil then
            if spec.kind == "int" or spec.kind == "number" then
                value = tonumber(value)
                if value == nil then return nil, "invalid_params: " .. spec.name .. " not a number" end
                if spec.kind == "int" then value = math.floor(value) end
                if (spec.min and value < spec.min) or (spec.max and value > spec.max) then
                    return nil, string.format("invalid_params: %s out of range (%s to %s)",
                        spec.name, tostring(spec.min or "any"), tostring(spec.max or "any"))
                end
            elseif spec.kind == "bool" then
                value = (value == true or value == "true" or value == "1")
            elseif spec.kind == "item_id" then
                value = tostring(value)
                if not value:match("^[%w_]+$") then return nil, "invalid_params: bad " .. spec.name end
            else
                value = tostring(value)
                if spec.max_len and #value > spec.max_len then value = value:sub(1, spec.max_len) end
            end
        end
        out[spec.name] = value
    end
    return out
end

-- ── action implementations ──────────────────────────────────────────────────
local PalUtility

local function pal_utility()
    if valid(PalUtility) then return PalUtility end
    local ok, found = pcall(StaticFindObject, "/Script/Pal.Default__PalUtility")
    if ok and valid(found) then
        PalUtility = found
        return PalUtility
    end
    return nil
end

local function find_player_state(userid)
    if userid == nil or userid == "" then return nil end
    local ok, states = pcall(FindAllOf, "PalPlayerState")
    if not ok or type(states) ~= "table" then return nil end
    for _, state in ipairs(states) do
        if valid(state) and player_userid(state) == userid then return state end
    end
    return nil
end

local function pawn_of(state)
    local controller = member(state, "GetPlayerController")
        and state:GetPlayerController() or nil
    if not valid(controller) then return nil, nil end
    local pawn = member(controller, "Pawn")
    if not valid(pawn) then return controller, nil end
    return controller, pawn
end

-- The NPC manager and the world both hang off a player controller, so a few
-- actions need some player online even when they name none.
local function any_player_controller()
    local ok, states = pcall(FindAllOf, "PalPlayerState")
    if not ok or type(states) ~= "table" then return nil end
    for _, state in ipairs(states) do
        if valid(state) then
            local controller = pawn_of(state)
            if valid(controller) then return controller end
        end
    end
    return nil
end

-- ── placement ───────────────────────────────────────────────────────────────
local function position_of(actor)
    if not valid(actor) then return nil end
    local ok, at = pcall(function() return actor:K2_GetActorLocation() end)
    if not ok or type(member(at, "X")) ~= "number" then return nil end
    return { X = at.X, Y = at.Y, Z = at.Z or 0 }
end

local function distance(a, b)
    if a == nil or b == nil then return nil end
    local dx, dy, dz = a.X - b.X, a.Y - b.Y, (a.Z or 0) - (b.Z or 0)
    return math.sqrt(dx * dx + dy * dy + dz * dz)
end

-- K2_TeleportTo moves an actor the engine already owns, but a possessed player
-- character on a dedicated server is moved by the game's own placement call —
-- the one the admin mods on this build use. Try that first, keep the engine
-- call as the fallback.
--
-- Verified as it goes: a call the engine accepts without moving the actor is
-- not a placement, so the next shape gets its turn. Placement that only lands
-- on a later frame reads as unmoved here, hence the tolerance and the
-- unverified answer rather than a failure.
local PLACE_TOLERANCE = 2000

local function place_actor(actor, at)
    local util = pal_utility()
    local shapes = {
        { util, "TeleportAroundLoccation", function()
            util:TeleportAroundLoccation(actor, { X = at.X, Y = at.Y, Z = at.Z },
                { X = 0, Y = 0, Z = 0, W = 0 })
        end },
        { actor, "K2_TeleportTo", function()
            actor:K2_TeleportTo({ X = at.X, Y = at.Y, Z = at.Z }, { Pitch = 0, Yaw = 0, Roll = 0 })
        end },
    }
    local ran, tried = nil, {}
    for _, shape in ipairs(shapes) do
        if declares(shape[1], shape[2]) then
            local ok, err = pcall(shape[3])
            if not ok then
                tried[#tried + 1] = shape[2] .. " -> " .. tostring(err)
            else
                ran = ran or shape[2]
                local landed = position_of(actor)
                if landed == nil or distance(landed, at) <= PLACE_TOLERANCE then
                    return true, shape[2]
                end
                tried[#tried + 1] = shape[2] .. " -> the actor did not move"
            end
        end
    end
    if ran then return true, ran .. " (unverified)" end
    return false, nil, tried
end

-- ── stats ───────────────────────────────────────────────────────────────────
-- Numbers arrive raw or wrapped in a fixed-point struct depending on the
-- field; unwrap both shapes.
local function as_number(value)
    if type(value) == "number" then return value end
    local inner = member(value, "Value")
    if type(inner) == "number" then return inner end
    return nil
end

-- Getters live on the character, its parameter component, or the individual
-- parameter depending on the stat and the build. Resolved fresh on every read:
-- a component reference does not survive the engine work in between.
local function stat_sources(character)
    return { character, member(character, "CharacterParameterComponent"), pal_parameter(character) }
end

local function stat_of(sources, method)
    for _, source in ipairs(sources) do
        if source ~= nil then
            local ok, value = pcall(function() return source[method](source) end)
            if ok then
                local number = as_number(value)
                if number then return number end
            end
        end
    end
    return nil
end

local function stat_value(character, method)
    return stat_of(stat_sources(character), method)
end

-- Combat/work stats live as fields on the pal's SaveParameter, not behind
-- getters. Writing them is AdminCommands' proven recipe: assign, mirror,
-- OnRep_SaveParameter to replicate.
local SAVE_STATS = {
    { "level", "Level" }, { "rank", "Rank" },
    { "talentHp", "Talent_HP" }, { "talentMelee", "Talent_Melee" },
    { "talentShot", "Talent_Shot" }, { "talentDefense", "Talent_Defense" },
    { "rankAttack", "Rank_Attack" }, { "rankDefence", "Rank_Defence" },
    { "rankCraftSpeed", "Rank_CraftSpeed" }, { "craftSpeed", "CraftSpeed" },
}

-- A player character carries the same save parameter as a pal, so these fields
-- accept a write and read back changed — but nothing in the game reads them for
-- a player. Refusing them is the only honest answer; a player's equivalents are
-- status points, which are a different system entirely.
local PAL_ONLY_STATS = {
    rank = true, talentHp = true, talentMelee = true, talentShot = true,
    talentDefense = true, rankAttack = true, rankDefence = true,
    rankCraftSpeed = true, craftSpeed = true,
}

local function is_player(character)
    return valid(member(character, "PlayerState"))
end

local STAT_GETTERS = {
    { "hp", "GetHP" }, { "maxHp", "GetMaxHP" },
    { "hunger", "GetFullStomach" }, { "maxHunger", "GetMaxFullStomach" },
    { "shield", "GetShieldValue" }, { "maxShield", "GetShieldMaxHP" },
    { "sanity", "GetSanityValue" },
}

local function read_stats(character)
    local sources = stat_sources(character)
    local parts = {}
    for _, entry in ipairs(STAT_GETTERS) do
        local value = stat_of(sources, entry[2])
        parts[#parts + 1] = json_string(entry[1], 24) .. ":" ..
            (value and json_value(value) or "null")
    end
    local save = member(sources[3], "SaveParameter")
    for _, entry in ipairs(SAVE_STATS) do
        local value = save and as_number(member(save, entry[2]))
        parts[#parts + 1] = json_string(entry[1], 24) .. ":" ..
            (value and json_value(value) or "null")
    end
    return "{" .. table.concat(parts, ",") .. "}"
end

-- The live stats that can be written, in the order they have to be applied:
-- a ceiling before the value that fills it, or the engine clamps the value to
-- the old maximum.
local WRITE_STATS = { "maxHp", "hp", "hunger", "maxShield", "shield" }

-- Fixed-point fields take a struct, plain ones take the number, and which is
-- which differs per field — so a declared setter is offered both.
local function number_shapes(holder, name, value)
    return {
        { holder, name, function() holder[name](holder, { Value = math.floor(value) }) end },
        { holder, name, function() holder[name](holder, value) end },
    }
end

local function append(shapes, more)
    for _, shape in ipairs(more) do shapes[#shapes + 1] = shape end
    return shapes
end

-- The calls to try for one stat, best first. HP is fixed point and the setter
-- this build is known to expose takes a rate, so callers work in the absolute
-- values the getters report and the maximum converts between the two.
local function stat_shapes(name, character, value)
    local util = pal_utility()
    local component = member(character, "CharacterParameterComponent")
    if name == "maxHp" then
        local shapes = append(number_shapes(component, "SetMaxHP", value),
            number_shapes(component, "SetMaxHPValue", value))
        shapes[#shapes + 1] = { util, "SetMaxHPToCharacter",
            function() util:SetMaxHPToCharacter(character, value) end }
        return shapes, "maxhp"
    end
    if name == "hp" then
        local max = stat_value(character, "GetMaxHP")
        local rate = max and max > 0 and math.min(1, math.max(0, value / max)) or nil
        local shapes = {}
        if rate then
            shapes[#shapes + 1] = { util, "SetHPByRateToCharacter",
                function() util:SetHPByRateToCharacter(character, rate) end }
            shapes[#shapes + 1] = { component, "SetHPByRate",
                function() component:SetHPByRate(rate) end }
        end
        return append(shapes, number_shapes(component, "SetHP", value)), "hp"
    end
    if name == "hunger" then
        local parameter = pal_parameter(character)
        local current = stat_value(character, "GetFullStomach") or 0
        return {
            { component, "SetFullStomach", function() component:SetFullStomach(value) end },
            { character, "SetFullStomach", function() character:SetFullStomach(value) end },
            { parameter, "SetFullStomach", function() parameter:SetFullStomach(value) end },
            { util, "SetFullStomach", function() util:SetFullStomach(character, value) end },
            { component, "AddFullStomach", function() component:AddFullStomach(value - current) end },
        }, "stomach"
    end
    if name == "shield" then
        local shapes = number_shapes(component, "SetShieldHP", value)
        shapes[#shapes + 1] = { util, "SetShieldHP", function() util:SetShieldHP(character, value) end }
        return shapes, "shield"
    end
    local shapes = number_shapes(component, "SetShieldMaxHP", value)
    shapes[#shapes + 1] = { util, "SetShieldMaxHP", function() util:SetShieldMaxHP(character, value) end }
    return shapes, "shield"
end

-- What to do instead, for a stat this build does not let anyone write. Max HP
-- is not stored anywhere: the game computes it, so the way up is the numbers it
-- computes from.
local STAT_HINT = {
    maxHp = "the game computes max HP from level, HP IV and rank rather than storing it — " ..
            "raise talentHp/level/rank, or raise maxShield instead",
}

local STAT_GETTER_OF = {
    hp = "GetHP", maxHp = "GetMaxHP", hunger = "GetFullStomach",
    shield = "GetShieldValue", maxShield = "GetShieldMaxHP",
}

-- Some live stats are also save-parameter fields, and the field can be the only
-- way in when the build exposes no setter for them: the same
-- assign-mirror-replicate recipe the combat stats use.
local SAVE_FIELD_OF = { hp = "HP", maxHp = "MaxHP", hunger = "FullStomach" }

local function write_save_field(character, field, value)
    local parameter = pal_parameter(character)
    local save = parameter and member(parameter, "SaveParameter")
    if save == nil or member(save, field) == nil then return false end
    local mirror = member(parameter, "SaveParameterMirror")
    -- Fixed-point fields hold their number behind Value; plain ones are the
    -- number itself.
    local fixed = type(member(save, field)) ~= "number" and member(member(save, field), "Value") ~= nil
    local ok = pcall(function()
        if fixed then
            save[field].Value = math.floor(value)
            if mirror and member(mirror, field) ~= nil then mirror[field].Value = math.floor(value) end
        else
            save[field] = value
            if mirror and member(mirror, field) ~= nil then mirror[field] = value end
        end
    end)
    if ok then pcall(function() parameter:OnRep_SaveParameter() end) end
    return ok
end

-- Everything this build declares anywhere near the stat, so a failure says what
-- does exist rather than only what does not.
local function stat_candidates(character, fragment)
    local seen, out = {}, {}
    for _, source in ipairs(stat_sources(character)) do
        for _, name in ipairs(candidates(source, fragment)) do
            if not seen[name] then
                seen[name] = true
                out[#out + 1] = name
            end
        end
    end
    return out
end

-- One write, then a read back: a call the engine accepts without moving the
-- value is reported as unverified rather than applied, and the save-parameter
-- field gets its turn before anything is called a failure. Returns the outcome
-- and a note when there is something to say — the engine capping the value, or
-- the reason nothing took.
local function apply_stat(character, name, value)
    local getter = STAT_GETTER_OF[name]
    local before = stat_value(character, getter)
    local shapes, fragment = stat_shapes(name, character, value)
    local ok, via, tried = call_shapes(shapes)

    -- nil when the value did not move at all; otherwise the outcome, plus a
    -- note when it moved but stopped short of what was asked for.
    local function moved()
        local after = stat_value(character, getter)
        if after == nil or before == nil then return "unverified", nil end
        if math.abs(after - value) <= math.max(1, math.abs(value) * 0.02) then return "applied", nil end
        if after ~= before then
            return "applied", string.format("reached %.6g of %.6g — the engine capped it", after, value)
        end
        return nil
    end

    if ok then
        local outcome, note = moved()
        if outcome then return outcome, note end
    end
    local field = SAVE_FIELD_OF[name]
    if field and write_save_field(character, field, value) then
        local outcome, note = moved()
        if outcome then return outcome, note end
    end
    if ok then return "unverified", "the call took but nothing changed (" .. tostring(via) .. ")" end

    local near = stat_candidates(character, fragment)
    local reason = (tried and tried[1]) or "no setter declared"
    if STAT_HINT[name] then reason = reason .. " — " .. STAT_HINT[name] end
    if #near > 0 then reason = reason .. "; declared: " .. table.concat(near, " ") end
    return "failed", reason
end

-- Applies whichever stats were supplied; a field left out is left alone.
local function write_stats(character, p)
    local applied, unverified, failed, notes = {}, {}, {}, {}
    local function record(name, outcome, note)
        if outcome == "applied" then
            applied[#applied + 1] = name
        elseif outcome == "unverified" then
            unverified[#unverified + 1] = name
        else
            failed[#failed + 1] = name
        end
        if note and note ~= "" then notes[#notes + 1] = name .. ": " .. note end
    end

    -- A value above its ceiling would simply be clamped, so the ceiling goes up
    -- with it unless the caller asked for a particular one.
    local wanted = {}
    for key, value in pairs(p) do wanted[key] = value end
    if p.hp ~= nil and p.maxHp == nil then
        local max = stat_value(character, "GetMaxHP")
        if max and p.hp > max then wanted.maxHp = p.hp end
    end
    p = wanted

    for _, name in ipairs(WRITE_STATS) do
        if p[name] ~= nil then record(name, apply_stat(character, name, p[name])) end
    end

    -- Save-parameter fields are plain assignments, read back from the field
    -- itself; replicate once at the end.
    local parameter = pal_parameter(character)
    local save = parameter and member(parameter, "SaveParameter")
    local mirror = parameter and member(parameter, "SaveParameterMirror")
    local touched = false
    local player = is_player(character)
    for _, entry in ipairs(SAVE_STATS) do
        local value = p[entry[1]]
        if value ~= nil then
            if player and PAL_ONLY_STATS[entry[1]] then
                record(entry[1], "failed",
                    "a pal stat — a player has no IVs, star rank or souls; " ..
                    "player.status_point is the equivalent")
            elseif not save then
                record(entry[1], "failed", "no save parameter on this character")
            else
                local ok = pcall(function()
                    save[entry[2]] = value
                    if mirror then mirror[entry[2]] = value end
                end)
                if not ok then
                    record(entry[1], "failed", "the engine refused the write")
                else
                    touched = true
                    record(entry[1], as_number(member(save, entry[2])) == value and "applied" or "unverified")
                end
            end
        end
    end
    if touched then pcall(function() parameter:OnRep_SaveParameter() end) end

    if #applied == 0 and #unverified == 0 then
        return false, "not_supported: " .. tostring(notes[1])
    end
    -- A partial success still has to say what the engine did with the rest, or
    -- the next attempt is another round of guessing.
    return true, nil, {
        { "applied", table.concat(applied, ",") },
        { "unverified", table.concat(unverified, ",") },
        { "failed", table.concat(failed, ",") },
        { "detail", #notes > 0 and table.concat(notes, "; ") or nil },
        { "stats", { raw = read_stats(character) } },
    }
end

-- ── status points ───────────────────────────────────────────────────────────
-- A player's max HP, stamina, attack and carry weight are not stored: the game
-- computes them from the points spent on each, which is why writing a level or
-- an IV onto a player changes nothing they can see. The spending lives on the
-- player controller on this build (AddPlayerStatusPoint_ToServer), not on the
-- state or the character, which is where the search starts.
local STATUS_HOLDER_CALLS = {
    "GetPlayerDataBase", "GetPlayerData", "GetPlayerRecordData", "GetPlayerInfo",
    "GetIndividualHandle", "GetPlayerParameterComponent",
}
local STATUS_HOLDER_FIELDS = {
    "PlayerDataBase", "PlayerData", "PlayerRecordData", "PlayerInfo",
    "PlayerParameterComponent", "StatusPointComponent",
}
local STATUS_READERS = { "GetStatusPoint", "GetStatusPointNum", "GetStatusPointValue" }

-- The two the player controller declares on this build are the ones the game's
-- own level-up screen calls; the rest are kept for builds that name them
-- differently. _ToServer is Palworld's client-to-server RPC naming, and the
-- agent runs on the server, so calling one executes it directly.
local STATUS_WRITERS = {
    "AddPlayerStatusPoint_ToServer", "Debug_SetStatusPoint_ToServer",
    "AddStatusPoint", "SetStatusPoint", "AddStatusPointNum",
}

-- Which name a point is spent under is the game's own FName, and this build
-- exposes no reader to enumerate them — so both spellings the game is known to
-- use are offered and the one that moves a stat is the right one.
local STATUS_STAT_NAMES = {
    "最大HP", "最大SP", "攻撃力", "所持重量", "捕獲率", "作業速度",
    "MaxHP", "MaxSP", "AttackPower", "WeightLoad", "CaptureRate", "WorkSpeed",
}

-- Everything a player's points could hang off, resolved fresh: the state, the
-- character, their controller, and whatever data object any of them hands out.
-- The record objects are not handed out by every build, so the ones reachable
-- by class name are included too — matched to this player where their id can be
-- read, since writing to the wrong player's record would be worse than failing.
local STATUS_CLASSES = { "PalPlayerDataBase", "PalPlayerData", "PalPlayerRecordData" }

local function status_holders(state, character)
    local holders, seen = {}, {}
    local function add(object)
        if valid(object) and not seen[tostring(object)] then
            seen[tostring(object)] = true
            holders[#holders + 1] = object
        end
    end
    local controller = pawn_of(state)
    add(state)
    add(character)
    add(controller)
    for _, source in ipairs({ state, character, controller }) do
        if valid(source) then
            for _, call in ipairs(STATUS_HOLDER_CALLS) do
                if declares(source, call) then
                    local ok, got = pcall(function() return source[call](source) end)
                    if ok then add(got) end
                end
            end
            for _, field in ipairs(STATUS_HOLDER_FIELDS) do add(member(source, field)) end
        end
    end

    local uid = player_userid(state)
    for _, class in ipairs(STATUS_CLASSES) do
        local ok, found = pcall(FindAllOf, class)
        if ok and type(found) == "table" then
            for _, record in ipairs(found) do
                if valid(record) and guid_hex(member(record, "PlayerUId")) == uid then add(record) end
            end
        end
    end
    return holders
end

local function read_status_points(state, character)
    for _, holder in ipairs(status_holders(state, character)) do
        for _, reader in ipairs(STATUS_READERS) do
            if declares(holder, reader) then
                local found = {}
                for _, name in ipairs(STATUS_STAT_NAMES) do
                    local ok, value = pcall(function() return holder[reader](holder, FName(name)) end)
                    local number = ok and as_number(value) or nil
                    if number then found[#found + 1] = { name, number } end
                end
                if #found > 0 then return found, holder, reader end
            end
        end
    end
    return nil
end

-- With no reader, the proof a point landed is the stat it feeds: snapshot what
-- the getters answer, spend, and see what moved.
local function stat_snapshot(character)
    local sources, out = stat_sources(character), {}
    for _, entry in ipairs(STAT_GETTERS) do out[entry[1]] = stat_of(sources, entry[2]) end
    return out
end

local function stats_moved(before, after)
    local changed = {}
    for _, entry in ipairs(STAT_GETTERS) do
        local was, now = before[entry[1]], after[entry[1]]
        if was ~= nil and now ~= nil and was ~= now then changed[#changed + 1] = entry[1] end
    end
    return changed
end

local function status_json(points)
    local parts = {}
    for _, entry in ipairs(points or {}) do
        parts[#parts + 1] = json_string(entry[1], 32) .. ":" .. json_value(entry[2])
    end
    return "{" .. table.concat(parts, ",") .. "}"
end

-- What the build has around status points, for when none of the shapes fit —
-- fields included, since a build that keeps the allocation in a property rather
-- than behind a getter would otherwise look empty. Each name is reported with
-- the class it sits on, because "which object" is half the answer.
local function status_candidates(state, character)
    local seen, out = {}, {}
    for _, holder in ipairs(status_holders(state, character)) do
        local where = (class_name(holder) or "?"):match("([^%.]+)$") or "?"
        for _, fragment in ipairs({ "statuspoint", "point" }) do
            for _, name in ipairs(candidates(holder, fragment, true)) do
                local labelled = where .. "." .. name
                if not seen[labelled] then
                    seen[labelled] = true
                    out[#out + 1] = labelled
                end
            end
        end
    end
    return out
end

-- ── hate ────────────────────────────────────────────────────────────────────
-- Retaliation runs on hate: damage adds hate toward the attacker and the AI
-- goes for whoever it hates most. A pal spawned through the NPC manager never
-- receives that first entry, so it stands there. The hate system object this
-- build hands out is not callable — the loader does not map its type — so the
-- hate has to be seeded through a function declared on a real object: the
-- character, its controller, or its parameter component.
local HATE_WITH_AMOUNT = { "PlusHateValue", "AddHateValue", "AddHate", "ChangeHateValue" }
local HATE_WITH_TARGET = { "SetHateTarget", "SetTargetCharacter", "SetAttackTarget" }
local HATE_DAMAGE = 1.0

local function hate_holders(character)
    local holders = { character }
    for _, field in ipairs({ "Controller", "CharacterParameterComponent", "AIController" }) do
        local held = member(character, field)
        if valid(held) then holders[#holders + 1] = held end
    end
    return holders
end

local function hate_shapes(character, target_pawn, amount)
    local shapes = {}
    for _, holder in ipairs(hate_holders(character)) do
        for _, name in ipairs(HATE_WITH_AMOUNT) do
            shapes[#shapes + 1] = { holder, name, function() holder[name](holder, target_pawn, amount) end }
        end
        for _, name in ipairs(HATE_WITH_TARGET) do
            shapes[#shapes + 1] = { holder, name, function() holder[name](holder, target_pawn) end }
        end
    end
    return shapes
end

-- The engine's own damage entry point, with the player as instigator: the path
-- a real hit takes, and the one shape here that does not depend on a
-- Pal-specific hate function existing.
local function damage_shape(character, target_controller, target_pawn)
    local ok, statics = pcall(StaticFindObject, "/Script/Engine.Default__GameplayStatics")
    if not ok or not valid(statics) then return nil end
    return { statics, "ApplyDamage", function()
        statics:ApplyDamage(character, HATE_DAMAGE, target_controller, target_pawn, nil)
    end }
end

-- The base NPC controller on this build declares no hate function at all, but
-- it does declare enemy targeting: AddTargetPlayer_ForEnemy puts a player on
-- the controller's target list and ForceBattleStartToTarget opens the fight.
-- The pair is one shape — targeting alone leaves the pal standing — and the
-- battle start may fail on its own without voiding the shape: the target
-- entry is worth keeping whichever signature the battle start wants.
local function enemy_target_shape(character, target_pawn)
    for _, holder in ipairs(hate_holders(character)) do
        if declares(holder, "AddTargetPlayer_ForEnemy") then
            return { holder, "AddTargetPlayer_ForEnemy", function()
                holder:AddTargetPlayer_ForEnemy(target_pawn)
                local outcomes = {}
                for _, starter in ipairs({ "ForceBattleStartToTarget", "ForceBattleStartForOutside" }) do
                    if declares(holder, starter) then
                        local took = pcall(function() holder[starter](holder, target_pawn) end)
                        if not took then took = pcall(function() holder[starter](holder) end) end
                        outcomes[#outcomes + 1] = starter .. (took and " took" or " failed")
                    end
                end
                -- Battle mode lives on the character, not the controller; the
                -- red enemy marker without a fight is the target list set
                -- while this flag stayed down.
                if declares(character, "ChangeBattleModeFlag") then
                    local took = pcall(function() character:ChangeBattleModeFlag(FName("Palladium"), true) end)
                    if not took then took = pcall(function() character:ChangeBattleModeFlag(true) end) end
                    outcomes[#outcomes + 1] = "ChangeBattleModeFlag" .. (took and " took" or " failed")
                end
                info("enemy target set; " .. table.concat(outcomes, ", "))
            end }
        end
    end
    return nil
end

local function seed_hate(character, target_controller, target_pawn, amount)
    local shapes = hate_shapes(character, target_pawn, amount)
    local enemy = enemy_target_shape(character, target_pawn)
    if enemy then table.insert(shapes, 1, enemy) end
    local damage = damage_shape(character, target_controller, target_pawn)
    if damage then shapes[#shapes + 1] = damage end
    local ok, via, tried = call_shapes(shapes)
    if ok then
        if tried and #tried > 0 then
            info("seed_hate: " .. via .. " took after: " .. table.concat(tried, "; "))
        end
        return true, via
    end
    local near = {}
    for _, holder in ipairs(hate_holders(character)) do
        for _, name in ipairs(candidates(holder, "hate")) do near[#near + 1] = name end
    end
    local detail = (tried and tried[1]) or "no hate function declared"
    if #near > 0 then detail = detail .. "; declared: " .. table.concat(near, " ") end
    return false, detail
end

-- Each handler: (state, params) → ok, error?, data_fields?
local IMPL = {}

-- One player's system chat. Announcing is the same call to everybody, which is
-- why it lives here rather than going out through the game's REST API: a mod
-- inside the game cannot reach that, and telling everyone something is not an
-- ability a modding framework can be missing.
local function send_system_chat(state, text)
    local util = pal_utility()
    local world = FindFirstOf("World")
    if not util or not valid(world) then return false, "not_supported" end
    local uid = member(state, "PlayerUId")
    if uid == nil then return false, "player_offline" end
    util:SendSystemToPlayerChat(world, text, { { A = uid.A, B = uid.B, C = uid.C, D = uid.D } })
    return true
end

IMPL["player.message"] = function(state, p)
    local ok, err = send_system_chat(state, p.text)
    if not ok then return false, err, {} end
    return true, nil, {}
end

IMPL["server.announce"] = function(_state, p)
    local ok, states = pcall(FindAllOf, "PalPlayerState")
    if not ok or type(states) ~= "table" then return false, "not_supported: no player list", {} end
    local sent, failed = 0, nil
    for _, state in ipairs(states) do
        if valid(state) then
            local delivered, err = send_system_chat(state, p.message)
            if delivered then sent = sent + 1 else failed = failed or err end
        end
    end
    -- Nobody online is not a failure; there was simply nobody to tell.
    if sent == 0 and failed then return false, failed, {} end
    return true, nil, { { "players", sent } }
end

IMPL["player.give_item"] = function(state, p)
    local inventory = state:GetInventoryData()
    if not inventory then return false, "player_offline" end
    inventory:AddItem_ServerInternal(FName(p.item), p.count, false, 0.0, true)
    return true, nil, { { "item", p.item }, { "count", p.count } }
end

-- The move lands a frame or two after the call, and the placement call puts a
-- player near the point rather than exactly on it, so the answer waits for the
-- engine and accepts an arrival within a short walk of where it was aimed.
local TELEPORT_SETTLE_MS = 400
local TELEPORT_TOLERANCE = 5000

IMPL["player.teleport"] = function(state, p, finish)
    local userid = player_userid(state)
    local _, pawn = pawn_of(state)
    if not pawn then return false, "player_offline" end

    -- A destination is coordinates, or another player: `to` names one and
    -- their position is the target — `!teleport to=@Name` is "take me to
    -- them", `!teleport @Name to=@me` is "bring them here".
    local target
    if p.to and p.to ~= "" then
        local _, dest_pawn = pawn_of(find_player_state(p.to))
        local at = dest_pawn and position_of(dest_pawn)
        if not at then return false, "invalid_params: to names nobody online" end
        target = { X = at.X + 150, Y = at.Y, Z = at.Z + 50 }
        -- The lookups above invalidated the held pawn; take it fresh.
        _, pawn = pawn_of(find_player_state(userid))
        if not pawn then return false, "player_offline" end
    elseif p.x ~= nil and p.y ~= nil and p.z ~= nil then
        target = { X = p.x, Y = p.y, Z = p.z }
    else
        return false, "invalid_params: give x, y and z — or to=@Name"
    end
    local before = position_of(pawn)
    local ok, via = place_actor(pawn, target)
    if not ok then return false, "teleport_failed: no placement call on this build" end
    if type(ExecuteWithDelay) ~= "function" then
        return true, nil, { { "x", target.X }, { "y", target.Y }, { "z", target.Z }, { "via", via } }
    end

    ExecuteWithDelay(TELEPORT_SETTLE_MS, function()
        guard("teleport check", function()
            local landed = position_of(select(2, pawn_of(find_player_state(userid))))
            if landed == nil then
                -- The player left, or their pawn is gone: the call is all the
                -- evidence there is.
                finish(true, nil, { { "x", target.X }, { "y", target.Y }, { "z", target.Z }, { "via", via } })
                return
            end
            local missed = distance(landed, target)
            local closer = before == nil or missed < distance(before, target)
            if missed > TELEPORT_TOLERANCE and not closer then
                finish(false, string.format("teleport_failed: still %.0f units away", missed), {
                    { "x", landed.X }, { "y", landed.Y }, { "z", landed.Z }, { "via", via },
                })
                return
            end
            finish(true, nil, {
                { "x", landed.X }, { "y", landed.Y }, { "z", landed.Z }, { "via", via },
            })
        end)
    end)
    return "deferred"
end

-- Full is whatever this character reports as its maximum, so the same call
-- works for a player and for a pal, and hunger is part of being healed.
IMPL["player.heal"] = function(state)
    local _, pawn = pawn_of(state)
    if not pawn then return false, "player_offline" end
    local wanted, any = {}, false
    for _, entry in ipairs({ { "hp", "GetMaxHP" }, { "hunger", "GetMaxFullStomach" },
                             { "shield", "GetShieldMaxHP" } }) do
        local max = stat_value(pawn, entry[2])
        if max and max > 0 then
            wanted[entry[1]] = max
            any = true
        end
    end
    if not any then return false, "not_supported: this character reports no maxima" end
    return write_stats(pawn, wanted)
end

local function item_count(state, item)
    local inventory = state:GetInventoryData()
    if not inventory then return nil, "player_offline" end
    local ok, count = pcall(function() return inventory:GetItemStackCount(FName(item)) end)
    if not ok or type(count) ~= "number" then
        ok, count = pcall(function() return inventory:CountItemNum(FName(item)) end)
    end
    if not ok or type(count) ~= "number" then return nil, "not_supported" end
    return count
end

IMPL["player.position"] = function(state)
    local _, pawn = pawn_of(state)
    if not pawn then return false, "player_offline" end
    local ok, at = pcall(function() return pawn:K2_GetActorLocation() end)
    if not ok or type(at) ~= "table" and type(at) ~= "userdata" then return false, "not_supported" end
    local x, y, z = member(at, "X"), member(at, "Y"), member(at, "Z")
    if type(x) ~= "number" then return false, "not_supported" end
    return true, nil, { { "x", x }, { "y", y or 0 }, { "z", z or 0 } }
end

IMPL["player.count_item"] = function(state, p)
    local count, err = item_count(state, p.item)
    if count == nil then return false, err end
    return true, nil, { { "item", p.item }, { "count", count } }
end

IMPL["player.has_item"] = function(state, p)
    local count, err = item_count(state, p.item)
    if count == nil then return false, err end
    return true, nil, { { "item", p.item }, { "has", count >= p.count }, { "count", count } }
end

-- Where a spawn is asked for and where the NPC manager puts it are not the
-- same thing: the manager belongs to a player and places its work near them.
-- Coordinates are honoured by moving the pal once it exists.
local SPAWN_PLACED_TOLERANCE = 500
local SPAWN_SETTLE_MS = 300
local HOSTILE_HATE = 10000

-- The engine's CharacterID is exact: "Sheepball" spawns nothing and the
-- English name "Lamball" is not an id at all. The generated table carries
-- both spellings of every known pal; anything it does not know passes
-- through untouched, which is what a modded species needs.
local function species_id(text)
    local canonical = CAPS.species and CAPS.species[tostring(text or ""):lower()]
    return canonical or text
end

-- Defined with the other pal helpers below; pal.spawn's settle needs them,
-- and forward declaration beats moving the whole block above the handler.
local world_pals, find_pal, make_sight_aggressive

IMPL["pal.spawn"] = function(state, p, finish)
    p.species = species_id(p.species)
    local util = pal_utility()
    local controller, pawn = pawn_of(state)
    -- The manager comes off some player's controller; with coordinates the
    -- caller need not name a player, so any online one will do.
    if not valid(controller) then controller = any_player_controller() end
    if not util or not valid(controller) then return false, "player_offline" end
    if not valid(util:GetNPCManager(controller)) then
        return false, "spawn_failed: no NPC manager"
    end

    local location, placed
    if p.x and p.y and p.z then
        location, placed = { X = p.x, Y = p.y, Z = p.z }, true
    else
        if not pawn then
            return false, "invalid_params: give coordinates or a target player"
        end
        local at = position_of(pawn)
        if at == nil then
            return false, "spawn_failed: could not read the player's location"
        end
        location = { X = at.X + 300, Y = at.Y, Z = at.Z + 100 }
    end

    -- Engine references do not survive intervening engine work, so the manager
    -- and the controller class are both resolved inside the attempt, right
    -- before the spawn call. Errors are reported rather than swallowed: the
    -- spawner's own message is the only thing that separates "rejected the
    -- controller" from "rejected the species".
    local last_error
    local function attempt(class_of, label)
        local manager = util:GetNPCManager(controller)
        if not valid(manager) then
            last_error = label .. ": NPC manager unavailable"
            return nil
        end
        local class = class_of(manager)
        if not valid(class) then
            last_error = label .. ": class not available on this build"
            return nil
        end
        local ok, spawned = pcall(function()
            return manager:SpawnNPCForServer({
                ControllerClass = class,
                CharacterID = FName(p.species),
                Level = p.level,
                Location = location,
                Yaw = 0.0,
                Squad = nil,
            }, nil)
        end)
        if not ok then
            last_error = label .. ": " .. tostring(spawned)
            info(string.format("spawn error with %s: %s", label, tostring(spawned)))
            return nil
        end
        if not valid(spawned) then
            last_error = label .. ": spawner returned nothing"
            return nil
        end
        return spawned
    end

    local function manager_field(field)
        return function(manager) return member(manager, field) end
    end

    -- The controller a wild pal actually runs. The manager's own class fields
    -- are the human-NPC set, whose behaviour tree has no attack actions: on
    -- the base controller, enemy targeting, battle start and battle mode all
    -- take and the pal still stands there (verified live). Only reachable by
    -- path — wild pals in the world keep the class loaded.
    local WILD_CONTROLLER = "/Game/Pal/Blueprint/Controller/Monster/" ..
        "BP_MonsterAIController_Wild.BP_MonsterAIController_Wild_C"
    -- StaticFindObject only answers for the exact path and only while loaded;
    -- a live wild controller's own class is the fallback that cannot go stale.
    local function wild_controller()
        local ok, class = pcall(StaticFindObject, WILD_CONTROLLER)
        if ok and valid(class) then return class end
        local found, instance = pcall(FindFirstOf, "BP_MonsterAIController_Wild_C")
        if found and valid(instance) then
            local got, live = pcall(function() return instance:GetClass() end)
            if got and valid(live) then
                info("wild controller class resolved from a live instance")
                return live
            end
        end
        info("wild controller class unresolved: StaticFindObject and live instance both failed")
        return nil
    end

    -- A combat controller if this build has one; the base class otherwise. The
    -- spawn must never be lost to the attempt, so the base is always tried.
    local controller_kind, handle
    if p.hostile then
        local combat = {
            { wild_controller, "MonsterAIController_Wild" },
            { manager_field("MonsterAIControllerClass"), "MonsterAIControllerClass" },
            { manager_field("EnemyAIControllerClass"), "EnemyAIControllerClass" },
        }
        for _, entry in ipairs(combat) do
            handle = attempt(entry[1], entry[2])
            if handle then
                controller_kind = entry[2]
                break
            end
            info("hostile spawn attempt failed — " .. tostring(last_error))
        end
        if not handle then
            info("no combat AI controller class on this build — spawning with the base controller. " ..
                 "Use pal.aggro to make the pal fight.")
        end
    end
    if not handle then
        controller_kind = "NPCAIControllerBaseClass"
        handle = attempt(manager_field("NPCAIControllerBaseClass"), "NPCAIControllerBaseClass")
    end
    if not handle then
        -- The spawner answers an unknown species with nothing, which makes a
        -- typo look like an engine fault; say the likelier cause.
        return false, "spawn_failed (" .. tostring(last_error) ..
            ") — a species this build does not know spawns nothing, and known pals answer to their English names too; the likeliest cause is a spelling the game has never heard"
    end

    -- Rarity and traits apply to the individual parameter once it exists.
    if p.rare or (p.traits and p.traits ~= "") then
        local function configure(attempt_no)
            if not valid(handle) then return end
            local parameter = handle:TryGetIndividualParameter()
            if not valid(parameter) then
                if attempt_no < 5 and type(ExecuteWithDelay) == "function" then
                    ExecuteWithDelay(250, function() configure(attempt_no + 1) end)
                end
                return
            end
            pcall(function()
                if p.rare then
                    parameter.SaveParameter.IsRarePal = true
                    parameter.SaveParameterMirror.IsRarePal = true
                end
                for trait in tostring(p.traits or ""):gmatch("[%w_]+") do
                    parameter:AddPassiveSkill(FName(trait), FName("None"))
                end
                parameter:OnRep_SaveParameter()
            end)
            if p.rare then
                pcall(function()
                    local actor = handle:TryGetIndividualActor()
                    if valid(actor) then actor:SetActorScale3D({ X = 1.5, Y = 1.5, Z = 1.5 }) end
                end)
            end
        end
        if type(ExecuteWithDelay) == "function" then
            ExecuteWithDelay(500, function() guard("pal.spawn configure", configure, 1) end)
        end
    end

    -- The pal's id and its actor both appear a moment after the spawn call, so
    -- the answer waits for them: the caller gets an id it can act on straight
    -- away, the coordinates are honoured, and hostility is applied to something
    -- that exists rather than to a handle that does not yet.
    local userid = state and player_userid(state) or ""

    -- The handle's TryGetIndividualActor never answers on this build even
    -- when the pal is long since standing in the world, so the actor comes
    -- from the world scan — by id when the scan agrees on it, else the
    -- nearest pal of the spawned species to the spawn point. Species
    -- casing differs between the request and the save ("SheepBall" vs
    -- "Sheepball"), hence the case-insensitive compare. Callers re-resolve
    -- immediately before every engine call: a reference does not survive
    -- intervening engine work.
    local RESOLVE_RADIUS = 5000
    local function resolve_actor(pal_id)
        local actor = valid(handle) and handle:TryGetIndividualActor() or nil
        if valid(actor) then return actor end
        local wanted = tostring(p.species):lower()
        local best, best_d
        for _, pal in ipairs(world_pals()) do
            if pal_id ~= "" and pal.id == pal_id then return pal.character end
            if tostring(pal.species):lower() == wanted then
                local at = position_of(pal.character)
                local d = at and distance(at, location)
                if d and (best_d == nil or d < best_d) then best, best_d = pal.character, d end
            end
        end
        if best and best_d <= RESOLVE_RADIUS then return best end
        return nil
    end

    -- The NPC manager silently refuses to spawn with the wild controller, but
    -- PalUtility.SpawnControllerAndPossess can attach one to a pawn that
    -- already exists. The signature is undocumented, so the plausible argument
    -- orders are tried until one takes; the result reports which.
    local function possess_wild(pal_id)
        if controller_kind ~= "NPCAIControllerBaseClass" then return end
        local wild = wild_controller()
        local fresh = pal_utility()
        if not wild or not fresh then
            info("wild possession skipped: " .. (wild and "no PalUtility" or "wild class unresolved"))
            return
        end
        local world = FindFirstOf("World")
        -- Resolved last, after every lookup above: an actor reference does
        -- not survive intervening engine work (see the header rules).
        local actor = resolve_actor(pal_id)
        if not valid(actor) then
            info("wild possession skipped: actor went stale before the call")
            return
        end
        local tries = {
            { "world,class,pawn", function() fresh:SpawnControllerAndPossess(world, wild, actor) end },
            { "class,pawn", function() fresh:SpawnControllerAndPossess(wild, actor) end },
            { "world,pawn,class", function() fresh:SpawnControllerAndPossess(world, actor, wild) end },
        }
        for _, try in ipairs(tries) do
            local took, err = pcall(try[2])
            if took then
                controller_kind = "MonsterAIController_Wild (possessed: " .. try[1] .. ")"
                info("wild possession took: " .. try[1])
                -- Possession alone leaves the brain idle: the wild controller
                -- runs Palworld's Action system, and PlayDefaultAction is the
                -- kick the game's own spawn path gives it.
                local again = resolve_actor(pal_id)
                local brain = valid(again) and member(again, "Controller") or nil
                if valid(brain) and declares(brain, "PlayDefaultAction") then
                    local kicked, kerr = pcall(function() brain:PlayDefaultAction() end)
                    info("PlayDefaultAction " .. (kicked and "took" or ("failed: " .. tostring(kerr))))
                else
                    info("PlayDefaultAction not declared on the possessed controller")
                end
                -- Combat permission is group membership, and the group call
                -- takes the pal's *handle* — the property the parameter
                -- component already holds (community modding kit signature;
                -- the actor-typed guess is what used to fault the process).
                -- The spawner scan stales references, so it runs first and
                -- the handle is read immediately before the call.
                local nearest_sp, nearest_d
                local okf, spawners = pcall(FindAllOf, "BP_PalSpawner_Standard_C")
                if okf and type(spawners) == "table" then
                    local at3 = position_of(resolve_actor(pal_id))
                    for _, sp in ipairs(spawners) do
                        if valid(sp) then
                            local lc = position_of(sp)
                            local dd = at3 and lc and distance(lc, at3)
                            if dd and (nearest_d == nil or dd < nearest_d) then
                                nearest_sp, nearest_d = sp, dd
                            end
                        end
                    end
                end
                if valid(nearest_sp) then
                    local fresh3 = resolve_actor(pal_id)
                    local parameter3 = valid(fresh3) and pal_parameter(fresh3) or nil
                    local handle = parameter3 and member(parameter3, "IndividualHandle") or nil
                    if handle ~= nil then
                        local adopted, aerr = pcall(function() nearest_sp:AddGroupCharacter(handle) end)
                        info("wild group adopt " .. (adopted and "took" or ("failed: " .. tostring(aerr))))
                    else
                        info("wild group adopt skipped: no IndividualHandle on the parameter")
                    end
                else
                    info("wild group adopt skipped: no pal spawner in the world")
                end
                local sighted, swhy = make_sight_aggressive(resolve_actor(pal_id))
                info("sight aggression " .. (sighted and "on" or ("failed: " .. tostring(swhy))))
                return
            end
            info("wild possession " .. try[1] .. " failed: " .. tostring(err))
        end
    end

    -- The base NPC controller has no combat behaviour, so hostility is the
    -- wild controller if possession works, plus the hate seed against the
    -- target either way.
    local function report(pal_id)
        local aggro = "none"
        local actor
        if p.hostile then
            local target_controller, target_pawn = pawn_of(find_player_state(userid))
            actor = resolve_actor(pal_id) -- the lookup above invalidated any held reference
            if not valid(actor) then
                aggro = "the spawned pal did not resolve"
            elseif target_pawn then
                possess_wild(pal_id)
                actor = resolve_actor(pal_id) -- possession swapped engine state again
                if valid(actor) then
                    local seeded, via = seed_hate(actor, target_controller, target_pawn, HOSTILE_HATE)
                    aggro = seeded and via or ("failed: " .. tostring(via))
                else
                    aggro = "actor lost after possession"
                end
            else
                aggro = "no target player online"
            end
        else
            actor = resolve_actor(pal_id)
        end
        local at = position_of(actor) or location
        finish(true, nil, {
            { "pal", pal_id },
            { "species", p.species },
            { "level", p.level },
            { "x", at.X }, { "y", at.Y }, { "z", at.Z },
            { "hostile", p.hostile == true },
            { "controller", controller_kind },
            { "aggro", aggro },
        })
    end

    local function settle(attempt_no)
        local parameter = valid(handle) and handle:TryGetIndividualParameter() or nil
        local pal_id = valid(parameter) and pal_id_of(parameter) or ""
        local actor = resolve_actor(pal_id)
        -- The handle is blind on this build — neither its parameter nor its
        -- actor ever answer — so once the world scan produced the actor, the
        -- id is read off the actor itself rather than waited for.
        if valid(actor) and pal_id == "" then
            local own = pal_parameter(actor)
            pal_id = own and pal_id_of(own) or ""
        end
        if (pal_id == "" or not valid(actor)) and attempt_no < 20
            and type(ExecuteWithDelay) == "function" then
            ExecuteWithDelay(250, function() guard("pal.spawn settle", settle, attempt_no + 1) end)
            return
        end
        if pal_id == "" or not valid(actor) then
            local scan = world_pals()
            local seen = 0
            for _, pal in ipairs(scan) do
                if tostring(pal.species):lower() == tostring(p.species):lower() then seen = seen + 1 end
            end
            info(string.format(
                "settle gave up after %d tries: id=%s, world scan has %d pals, %d of species %s",
                attempt_no, pal_id == "" and "none" or pal_id, #scan, seen, tostring(p.species)))
        end

        -- The manager places its work near the player who owns it, so explicit
        -- coordinates are honoured by moving the pal once it exists. The move
        -- lands a frame later, hence the wait before reading the position back.
        local at = position_of(actor)
        if placed and valid(actor) and (at == nil or distance(at, location) > SPAWN_PLACED_TOLERANCE) then
            place_actor(actor, location)
            if type(ExecuteWithDelay) == "function" then
                ExecuteWithDelay(SPAWN_SETTLE_MS, function()
                    guard("pal.spawn report", function()
                        report(pal_id)
                    end)
                end)
                return
            end
        end
        report(pal_id)
    end
    guard("pal.spawn settle", settle, 1)
    return "deferred"
end

IMPL["player.stats"] = function(state)
    local _, pawn = pawn_of(state)
    if not pawn then return false, "player_offline" end
    return true, nil, { { "stats", { raw = read_stats(pawn) } } }
end

-- Answers for offline players too: the total is history, not presence, so
-- the id from the registry is enough and no engine object is touched.
IMPL["player.playtime"] = function(_state, _p, _finish, raw)
    local userid = raw.userid or ""
    if userid == "" then return false, "invalid_params: no player given", {} end
    local record = playtime:get(userid)
    local started = session_start[userid]
    return true, nil, {
        { "minutes", record and tonumber(record.minutes) or 0 },
        { "session", started and math.floor((os.time() - started) / 60) or 0 },
        { "online", present[userid] ~= nil },
        { "name", (record and record.name) or present[userid] or "" },
    }
end

IMPL["player.set_stats"] = function(state, p)
    local _, pawn = pawn_of(state)
    if not pawn then return false, "player_offline" end
    return write_stats(pawn, p)
end

IMPL["player.status_points"] = function(state)
    local _, pawn = pawn_of(state)
    if not pawn then return false, "player_offline" end
    local points, holder, reader = read_status_points(state, pawn)
    -- No reader is not a failure: the names are still spendable, and which one
    -- this build answers to is settled by spending on it.
    local names = {}
    for i, name in ipairs(STATUS_STAT_NAMES) do names[i] = json_string(name, 32) end
    return true, nil, {
        { "readable", points ~= nil },
        { "via", reader or "none" },
        { "holder", holder and class_name(holder) or "none" },
        { "points", { raw = points and status_json(points) or "{}" } },
        { "names", { raw = "[" .. table.concat(names, ",") .. "]" } },
    }
end

-- Additive, because that is the shape the game's own level-up spends them in.
-- The stat name is the game's own FName and is passed through verbatim; the
-- parameter may be a name or an enum index depending on the build, so both go
-- to the same declared function.
IMPL["player.status_point"] = function(state, p)
    local _, pawn = pawn_of(state)
    if not pawn then return false, "player_offline" end
    local stat, count = tostring(p.stat), p.points or 1
    local index = tonumber(stat)

    local before = stat_snapshot(pawn)
    local spent_before
    for _, entry in ipairs(read_status_points(state, pawn) or {}) do
        if entry[1] == stat then spent_before = entry[2] end
    end

    local shapes = {}
    for _, holder in ipairs(status_holders(state, pawn)) do
        for _, writer in ipairs(STATUS_WRITERS) do
            shapes[#shapes + 1] = { holder, writer,
                function() holder[writer](holder, FName(stat), count) end }
            shapes[#shapes + 1] = { holder, writer,
                function() holder[writer](holder, stat, count) end }
            if index then
                shapes[#shapes + 1] = { holder, writer,
                    function() holder[writer](holder, index, count) end }
            end
        end
    end
    local ok, via, tried = call_shapes(shapes)
    if not ok then
        local near = status_candidates(state, pawn)
        local reason = (tried and tried[1]) or "no status-point setter declared"
        if #near > 0 then reason = reason .. "; declared: " .. table.concat(near, " ") end
        return false, "not_supported: " .. reason
    end

    local changed = stats_moved(before, stat_snapshot(pawn))
    local spent_after
    for _, entry in ipairs(read_status_points(state, pawn) or {}) do
        if entry[1] == stat then spent_after = entry[2] end
    end
    local verified = #changed > 0
        or (spent_before ~= nil and spent_after ~= nil and spent_after ~= spent_before)
    return true, nil, {
        { "stat", stat },
        { "points", count },
        { "via", via },
        { "verified", verified },
        { "changed", table.concat(changed, ",") },
        { "detail", not verified and
            "the call took but no readable stat moved — this may be the wrong name for it" or nil },
        { "stats", { raw = read_stats(pawn) } },
    }
end

-- ── pals in the world ───────────────────────────────────────────────────────
function world_pals() -- forward-declared above pal.spawn
    local ok, characters = pcall(FindAllOf, "PalCharacter")
    if not ok or type(characters) ~= "table" then return {} end
    local out = {}
    for _, character in ipairs(characters) do
        if valid(character) and state_of(character) == nil then -- players excluded
            local parameter = pal_parameter(character)
            if parameter then
                local save = member(parameter, "SaveParameter")
                local species = save and to_text(member(save, "CharacterID"))
                if species and species ~= "None" then
                    out[#out + 1] = {
                        character = character,
                        parameter = parameter,
                        id = pal_id_of(parameter),
                        species = species,
                        level = type(member(save, "Level")) == "number" and member(save, "Level") or 0,
                        rare = member(save, "IsRarePal") == true,
                    }
                end
            end
        end
    end
    return out
end

local MAX_PAL_LIST = 100

IMPL["pal.list"] = function(_, _)
    local rows = {}
    local pals = world_pals()
    for i = 1, math.min(#pals, MAX_PAL_LIST) do
        local pal = pals[i]
        local pos = ""
        local ok, at = pcall(function() return pal.character:K2_GetActorLocation() end)
        if ok and type(member(at, "X")) == "number" then
            pos = string.format(',"x":%.1f,"y":%.1f,"z":%.1f', at.X, at.Y, at.Z)
        end
        rows[#rows + 1] = string.format(
            '{"id":%s,"species":%s,"level":%d,"rare":%s%s}',
            json_string(pal.id, 64), json_string(pal.species, 64),
            pal.level, pal.rare and "true" or "false", pos)
    end
    return true, nil, {
        { "count", #pals },
        { "truncated", #pals > MAX_PAL_LIST },
        { "pals", { raw = "[" .. table.concat(rows, ",") .. "]" } },
    }
end

-- Whether a hate system exists on this pal at all. It answers nothing about
-- who the pal hates: the object itself is not callable on this build, which is
-- why pal.aggro goes through declared functions instead.
local function hate_system(character)
    for _, source in ipairs(hate_holders(character)) do
        local ok, system = pcall(function() return source:GetHateSystem() end)
        if ok and system ~= nil then return system, source end
        local direct = member(source, "HateSystem")
        if direct ~= nil then return direct, source end
    end
    return nil
end

function find_pal(pal_id) -- forward-declared above pal.spawn
    for _, pal in ipairs(world_pals()) do
        if pal.id ~= "" and pal.id == pal_id then return pal end
    end
    return nil
end

-- The world's own spawners are the path the game itself uses, and they attach
-- whatever AI a wild pal gets — including predators, which are hostile by
-- design. Spawner actors are reachable by class name (the same discovery
-- AlphaRespawnScheduler uses in production), so ask one near the player to
-- fire rather than constructing an NPC by hand.
local SPAWNER_CLASSES = { "BP_MonoNPCSpawner_C", "BP_PalSpawner_Standard_C" }

IMPL["pal.spawn_wild"] = function(state, p)
    if p.species and p.species ~= "" then p.species = species_id(p.species) end
    local _, pawn = pawn_of(state)
    if not pawn then return false, "player_offline" end
    local at = position_of(pawn)
    if at == nil then
        return false, "spawn_failed: could not read the player's location"
    end

    local want_boss = p.kind == "boss"
    local want_species = p.species ~= nil and p.species ~= ""
    local radius = p.radius or 50000
    local found, in_range, errors = 0, 0, {}
    local best, best_distance, best_boss

    for _, class_name in ipairs(SPAWNER_CLASSES) do
        -- A species override rewrites a pal spawner's lottery, so only the
        -- pal spawner class qualifies when one is asked for.
        if want_species and class_name ~= "BP_PalSpawner_Standard_C" then goto next_class end
        local ok, spawners = pcall(FindAllOf, class_name)
        if ok and type(spawners) == "table" then
            for _, spawner in ipairs(spawners) do
                if valid(spawner) then
                    found = found + 1
                    local loc = position_of(spawner)
                    if loc then
                        local dx, dy = loc.X - at.X, loc.Y - at.Y
                        local away = math.sqrt(dx * dx + dy * dy)
                        if away <= radius then
                            in_range = in_range + 1
                            local is_boss = member(spawner, "IsBossSpawner") == true
                            -- Prefer a boss spawner when asked (alphas are
                            -- hostile); otherwise simply take the nearest.
                            local better = best == nil
                                or (want_boss and is_boss and not best_boss)
                                or ((want_boss and is_boss == (best_boss == true)) and away < best_distance)
                                or (not want_boss and away < best_distance)
                            if better then
                                best, best_distance, best_boss = spawner, away, is_boss
                            end
                        end
                    end
                end
            end
        end
        ::next_class::
    end

    if found == 0 then return false, "not_supported: no spawner actors in the world" end
    if not best then
        return false, string.format("no spawner within %d units (%d exist)", radius, found)
    end

    -- With a species, the chosen spawner's lottery is rewritten before the
    -- shot — struct layout and signatures from the community modding kit,
    -- not guessed. The game then does all of its own wiring: controller,
    -- wild group, combat permission — everything a hand spawn cannot reach.
    -- The list is restored in the same breath: the lottery is drawn during
    -- the fire call, so the originals can go straight back.
    local saved = {}
    if want_species then
        local rewritten = pcall(function()
            local groups = best.SpawnGroupList
            for i = 1, #groups do
                local pals = groups[i].PalList
                for j = 1, #pals do
                    local tribe = pals[j]
                    saved[#saved + 1] = {
                        i = i, j = j,
                        key = tribe.PalId.Key,
                        level = tribe.Level, level_max = tribe.Level_Max,
                        num = tribe.Num, num_max = tribe.Num_Max,
                    }
                    tribe.PalId.Key = FName(p.species)
                    tribe.Level = p.level or 15
                    tribe.Level_Max = p.level or 15
                    tribe.Num = 1
                    tribe.Num_Max = 1
                end
            end
        end)
        if not rewritten or #saved == 0 then
            return false, "not_supported: this spawner's lottery could not be rewritten"
        end
        pcall(function() best:ResetLottery() end)
    end

    local function restore_lottery()
        if #saved == 0 then return end
        pcall(function()
            local groups = best.SpawnGroupList
            for _, entry in ipairs(saved) do
                local tribe = groups[entry.i].PalList[entry.j]
                tribe.PalId.Key = entry.key
                tribe.Level = entry.level
                tribe.Level_Max = entry.level_max
                tribe.Num = entry.num
                tribe.Num_Max = entry.num_max
            end
        end)
        pcall(function() best:ResetLottery() end)
    end

    -- The calls AlphaRespawnScheduler uses in production on this same build:
    -- clear the timer, then ask the spawner to fire. A pal that arrives this
    -- way is spawned by the game itself and behaves like any other wild one.
    pcall(function() best.RespawnTimer = 0.0 end)
    pcall(function() best.RespawnTime = 0.0 end)

    -- With a species, the spawner's living brood is replaced outright —
    -- SpawnRequest_ByOutside(true) — or an occupied spawner would answer the
    -- rewritten lottery with nothing. Without one, the gentle order stands.
    local shapes
    if want_species then
        shapes = {
            { "SpawnRequest_ByOutside(true)", function() return best:SpawnRequest_ByOutside(true) end },
            { "RespawnByOutside()", function() return best:RespawnByOutside() end },
            { "SpawnRequest_ByOutside(false)", function() return best:SpawnRequest_ByOutside(false) end },
        }
    else
        shapes = {
            { "RespawnByOutside()", function() return best:RespawnByOutside() end },
            { "SpawnRequest_ByOutside(false)", function() return best:SpawnRequest_ByOutside(false) end },
            { "SpawnRequest_ByOutside(true)", function() return best:SpawnRequest_ByOutside(true) end },
        }
    end
    for _, shape in ipairs(shapes) do
        local called, err = pcall(shape[2])
        if called then
            -- The spawner works through its request on later ticks, so the
            -- list is restored after it has had its read — on the game
            -- thread, where struct writes belong.
            if #saved > 0 and type(ExecuteWithDelay) == "function" then
                ExecuteWithDelay(8000, function()
                    guard("spawn_wild lottery restore", function()
                        if valid(best) then restore_lottery() end
                    end)
                end)
            end
            -- A species can also be made to mean it: once the spawn has
            -- landed, the nearest one of its kind to the spawner gets the
            -- attack-on-sight temperament.
            if want_species and p.aggressive and type(ExecuteWithDelay) == "function" then
                local best_at = position_of(best)
                for _, delay in ipairs({ 1200, 4000 }) do
                ExecuteWithDelay(delay, function()
                    guard("spawn_wild temperament", function()
                        local wanted = tostring(p.species):lower()
                        local nearest, nearest_d
                        for _, pal in ipairs(world_pals()) do
                            if tostring(pal.species):lower() == wanted then
                                local at2 = position_of(pal.character)
                                local d2 = at2 and best_at and distance(at2, best_at)
                                if d2 and (nearest_d == nil or d2 < nearest_d) then
                                    nearest, nearest_d = pal.character, d2
                                end
                            end
                        end
                        if nearest then
                            local turned, why = make_sight_aggressive(nearest)
                            info("spawn_wild temperament " ..
                                (turned and "set: attack on sight" or ("failed: " .. tostring(why))))
                        else
                            info("spawn_wild temperament: no " .. tostring(p.species) .. " landed to set")
                        end
                    end)
                end)
                end
            end
            return true, nil, {
                { "method", shape[1] },
                { "boss", best_boss == true },
                { "species", want_species and p.species or "" },
                { "overridden", #saved },
                { "distance", math.floor(best_distance) },
                { "spawnersInRange", in_range },
            }
        end
        errors[#errors + 1] = shape[1] .. " -> " .. tostring(err)
    end

    restore_lottery()
    info("pal.force_spawn: no shape worked: " .. table.concat(errors, " | "))
    return false, "not_supported: " .. tostring(errors[1])
end

IMPL["pal.force_spawn"] = function(...) return IMPL["pal.spawn_wild"](...) end -- deprecated alias

-- Diagnostic: everything that could plausibly differ between a wild pal (which
-- fights back) and a spawned one (which does not). Pure property reads, so it
-- is safe to point at anything. Compare the two and the difference is the bug.
IMPL["pal.inspect"] = function(_, p)
    local pal = find_pal(p.pal)
    if not pal then return false, "pal_not_found" end
    local character, parameter = pal.character, pal.parameter
    local save = member(parameter, "SaveParameter")

    local controller_name = "none"
    local controller = member(character, "Controller")
    if not valid(controller) then
        local ok, got = pcall(function() return character:GetAIController() end)
        if ok then controller = got end
    end
    if valid(controller) then
        -- ToString does not name a UClass; GetFullName/GetFName do. This is the
        -- one field that can distinguish a wild pal's brain from a spawned
        -- one's, so try every naming call rather than settling for "unnamed".
        local ok, class = pcall(function() return controller:GetClass() end)
        for _, source in ipairs({ (ok and class) or nil, controller }) do
            for _, method in ipairs({ "GetFullName", "GetFName", "GetName" }) do
                local got, name = pcall(function() return source[method](source) end)
                if got then
                    local text = to_text(name) or (type(name) == "string" and name or nil)
                    if text and text ~= "" then
                        controller_name = text
                        break
                    end
                end
            end
            if controller_name ~= "none" and controller_name ~= "unnamed" then break end
        end
    end

    local owner = save and member(save, "OwnerPlayerUId")
    local owner_hex = owner and guid_hex(owner) or ""

    local spawned_type = nil
    local static_param = member(character, "StaticCharacterParameterComponent")
    if valid(static_param) then
        local ok, value = pcall(function() return static_param:GetSpawnedCharacterType() end)
        if ok then spawned_type = as_number(value) end
    end

    return true, nil, {
        { "pal", p.pal },
        { "species", pal.species },
        { "controller", controller_name },
        { "hasController", valid(controller) },
        { "owner", owner_hex ~= "" and owner_hex or "none" },
        { "isOtomo", member(save, "IsOtomo") == true },
        { "spawnedType", spawned_type },
        { "hateSystem", hate_system(character) ~= nil },
    }
end

-- Temperament is the sensor's response preset: what the AI does when it
-- *discovers* someone, before any damage — Ignore(0), Escape(1), Battle(2),
-- Special(3), Battle_Anyway(4). A docile species carries Ignore, which is
-- why a wild spawn of one watches you walk past. Setting every Discover_*
-- to Battle_Anyway is the attack-on-sight switch. The preset object may be
-- shared by the species' other individuals until the next restart — for a
-- deliberately hostile spawn, that is the accepted cost.
function make_sight_aggressive(character) -- forward-declared above pal.spawn
    local controller = member(character, "Controller")
    local sensor = valid(controller) and member(controller, "PalAISensor") or nil
    if not valid(sensor) then return false, "no PalAISensor on the controller" end
    local preset = member(sensor, "AIResponsePreset")
    if preset == nil then return false, "no AIResponsePreset on the sensor" end
    local set = 0
    for _, field in ipairs({ "Discover_Player", "Discover_Greater", "Discover_Equal", "Discover_Smaller" }) do
        local wrote = pcall(function() preset[field] = 4 end)
        if wrote then set = set + 1 end
    end
    if set == 0 then return false, "the preset refused every write" end
    return true, nil
end

IMPL["pal.aggro"] = function(state, p)
    local pal = find_pal(p.pal)
    if not pal then return false, "pal_not_found" end
    local controller, pawn = pawn_of(state)
    if not pawn then return false, "player_offline" end

    local sight = "off"
    if p.sight then
        local turned, why = make_sight_aggressive(pal.character)
        sight = turned and "on" or ("failed: " .. tostring(why))
        -- The sight flip needs no target and stands on its own; the hate
        -- seed below aims the pal at the caller as before. The pal was
        -- resolved before the flip touched the engine, so resolve it again.
        pal = find_pal(p.pal)
        if not pal then
            return true, nil, { { "pal", p.pal }, { "sight", sight },
                { "via", "the pal went away mid-call" } }
        end
    end

    local amount = p.amount or 1000
    local ok, via = seed_hate(pal.character, controller, pawn, amount)
    if not ok then
        info("pal.aggro: no hate shape took — " .. tostring(via))
        if sight == "on" then
            return true, nil, { { "pal", p.pal }, { "sight", sight },
                { "via", "sight only: " .. tostring(via) } }
        end
        return false, "not_supported: " .. tostring(via)
    end
    return true, nil, { { "pal", p.pal }, { "amount", amount }, { "via", via }, { "sight", sight } }
end

IMPL["pal.stats"] = function(_, p)
    local pal = find_pal(p.pal)
    if not pal then return false, "pal_not_found" end
    return true, nil, {
        { "pal", p.pal }, { "species", pal.species },
        { "stats", { raw = read_stats(pal.character) } },
    }
end

IMPL["pal.set_stats"] = function(_, p)
    local pal = find_pal(p.pal)
    if not pal then return false, "pal_not_found" end
    local ok, err, data = write_stats(pal.character, p)
    if not ok then return false, err end
    table.insert(data, 1, { "pal", p.pal })
    return true, nil, data
end

-- ── probe ───────────────────────────────────────────────────────────────────
-- What this build exposes, rather than what a signature list assumes. Every
-- not_supported above ends in a question this answers, so the next attempt
-- starts from the names the engine actually declares.
local MAX_PROBE_NAMES = 250

local function probe_subject(name, state, p)
    -- Any live object by its class name, which is how an object nothing hands
    -- out gets inspected at all.
    local wanted = name:match("^class:(.+)$")
    if wanted then
        local ok, found = pcall(FindFirstOf, wanted)
        if not ok or not valid(found) then
            return nil, "not_supported: no live " .. wanted .. " in the world"
        end
        return found
    end
    if name == "controller" then
        local controller = pawn_of(state)
        if not valid(controller) then return nil, "player_offline" end
        return controller
    end
    if name == "player" or name == "params" then
        local _, pawn = pawn_of(state)
        if not pawn then return nil, "player_offline" end
        if name == "params" then return member(pawn, "CharacterParameterComponent") end
        return pawn
    end
    -- The player's own record rather than their body: status points, guild,
    -- inventory handles — the things that are not on the character.
    if name == "state" then
        if not valid(state) then return nil, "player_offline" end
        return state
    end
    if name == "utility" then return pal_utility() end
    if name == "manager" then
        local util = pal_utility()
        local controller = pawn_of(state)
        if not valid(controller) then controller = any_player_controller() end
        if not util or not valid(controller) then return nil, "player_offline" end
        return util:GetNPCManager(controller)
    end
    if name == "spawner" then
        for _, class in ipairs(SPAWNER_CLASSES) do
            local ok, spawners = pcall(FindAllOf, class)
            if ok and type(spawners) == "table" then
                for _, spawner in ipairs(spawners) do
                    if valid(spawner) then return spawner end
                end
            end
        end
        return nil, "not_supported: no spawner actors in the world"
    end
    local pal = find_pal(p.pal or "")
    if not pal then return nil, "pal_not_found" end
    if name == "palai" then return member(pal.character, "Controller") end
    if name == "palparams" then return member(pal.character, "CharacterParameterComponent") end
    return pal.character
end

local function json_list(names)
    local quoted = {}
    for i, name in ipairs(names) do quoted[i] = json_string(name, 96) end
    return "[" .. table.concat(quoted, ",") .. "]"
end

IMPL["bridge.probe"] = function(state, p)
    -- Class names are case sensitive, the shorthands are not.
    local on = tostring(p.on or "player")
    if not on:find(":", 1, true) then on = on:lower() end
    local subject, err = probe_subject(on, state, p)
    if subject == nil then return false, err or "not_supported: nothing to probe" end
    if not valid(subject) then return false, "not_supported: " .. on .. " is not available here" end

    local filter = tostring(p.filter or ""):lower()
    local calls, call_count = matching(functions_of(subject), filter, MAX_PROBE_NAMES)
    local fields, field_count = matching(properties_of(subject), filter, MAX_PROBE_NAMES)
    return true, nil, {
        { "on", on },
        { "class", class_name(subject) or "unknown" },
        { "count", call_count + field_count },
        { "functions", { raw = json_list(calls) } },
        { "properties", { raw = json_list(fields) } },
    }
end



-- ── permissions and tags, in the process that owns them ─────────────────────
-- These used to be answered by the panel against its database. They are the
-- agent's now, because a mod running in here has to be able to ask the same
-- questions with no panel in the picture — and because two copies of the
-- answer is one copy too many.

IMPL["permission.register"] = function(_state, p)
    local mod = tostring(p.mod or ""):lower()
    if not mod:match("^[a-z0-9_-][a-z0-9_-]*$") then return false, "invalid_params: mod", {} end
    local node = tostring(p.node or ""):lower()
    -- A mod may only name nodes under itself. `bridge` is the exception on
    -- purpose: it is not a mod competing for names, it is the framework, and
    -- its nodes are the capability types themselves — `pal.spawn` gates
    -- pal.spawn.
    if mod ~= "bridge" and node:sub(1, #mod + 1) ~= mod .. "." then
        return false, string.format("invalid_params: node '%s' must start with '%s.'", node, mod), {}
    end
    perms:register(mod, { { node = node, description = p.description, default = p.default } })
    return true, nil, { { "node", node } }
end

IMPL["permission.check"] = function(_state, p, _finish, raw)
    -- Everything beyond the node is the call being asked about, so a
    -- constrained grant is matched here rather than by whoever asked.
    local params = {}
    for key, value in pairs(raw or {}) do
        if key ~= "id" and key ~= "action" and key ~= "userid" and key ~= "node" then
            params[key] = value
        end
    end
    local allowed, source, where, violation = perms:resolve(raw.userid or "", p.node, params)
    return true, nil, {
        { "allowed", allowed == true },
        { "source", source },
        { "constraints", where },
        { "violation", violation },
    }
end

IMPL["permission.nodes"] = function()
    local parts = {}
    local ids = {}
    for node in pairs(perms:nodes()) do ids[#ids + 1] = node end
    table.sort(ids)
    for _, node in ipairs(ids) do
        local record = perms:nodes()[node]
        parts[#parts + 1] = string.format('{"node":%s,"mod":%s,"description":%s,"default":%s}',
            json_string(node, 128), json_string(perms.owner_of(node), 32),
            json_string(record.description or "", 200), json_string(record.default, 8))
    end
    return true, nil, { { "nodes", { raw = "[" .. table.concat(parts, ",") .. "]" } } }
end

IMPL["permission.grant"] = function(_state, p, _finish, raw)
    local ok, err = perms:grant(raw.userid or "", p.node, p.effect, p.where, p["until"])
    if not ok then return false, err, {} end
    return true, nil, { { "node", p.node }, { "until", p["until"] or "" } }
end

IMPL["permission.revoke"] = function(_state, p, _finish, raw)
    return perms:revoke(raw.userid or "", p.node) == true, nil, { { "node", p.node } }
end

IMPL["permission.player"] = function(_state, p, _finish, raw)
    local uid = raw.userid or ""
    local groups = {}
    for _, group in ipairs(perms:groups_of(uid)) do groups[#groups + 1] = json_string(group.name, 64) end
    local entries = {}
    for _, entry in ipairs(perms:user_entries(uid)) do
        entries[#entries + 1] = string.format('{"node":%s,"effect":%s,"where":%s,"until":%s}',
            json_string(entry.node, 128), json_string(entry.effect, 8),
            json_string(entry.where or "", 200), json_string(entry.until_stamp or "", 20))
    end
    return true, nil, {
        { "groups", { raw = "[" .. table.concat(groups, ",") .. "]" } },
        { "entries", { raw = "[" .. table.concat(entries, ",") .. "]" } },
        { "role", perms:role(uid) },
    }
end

IMPL["group.create"] = function(_state, p)
    local ok, err = perms:group_create(p.name, p.tag, p.weight)
    return ok == true, err, { { "name", p.name } }
end

IMPL["group.update"] = function(_state, p)
    local ok, err = perms:group_update(p.name, p.tag, p.weight)
    return ok == true, err, { { "name", p.name } }
end

IMPL["group.delete"] = function(_state, p)
    local ok, err = perms:group_delete(p.name)
    return ok == true, err, { { "name", p.name } }
end

IMPL["group.set_entry"] = function(_state, p)
    local ok, err = perms:group_set_entry(p.group, p.node, p.effect, p.where, p["until"])
    return ok == true, err, { { "group", p.group }, { "node", p.node } }
end

IMPL["group.remove_entry"] = function(_state, p)
    local ok, err = perms:group_remove_entry(p.group, p.node)
    return ok == true, err, { { "group", p.group }, { "node", p.node } }
end

IMPL["group.assign"] = function(_state, p, _finish, raw)
    local ok, err = perms:assign(raw.userid or "", p.group)
    return ok == true, err, { { "group", p.group } }
end

IMPL["group.unassign"] = function(_state, p, _finish, raw)
    return perms:unassign(raw.userid or "", p.group) == true, nil, { { "group", p.group } }
end

IMPL["group.list"] = function()
    local parts = {}
    local names = {}
    for name in pairs(perms:groups()) do names[#names + 1] = name end
    table.sort(names)
    for _, name in ipairs(names) do
        local record = perms:groups()[name]
        local entries = {}
        for _, entry in ipairs(perms:entries_of(name)) do
            entries[#entries + 1] = string.format('{"node":%s,"effect":%s,"where":%s,"until":%s}',
                json_string(entry.node, 128), json_string(entry.effect, 8),
                json_string(entry.where or "", 200), json_string(entry.until_stamp or "", 20))
        end
        parts[#parts + 1] = string.format(
            '{"name":%s,"tag":%s,"weight":%d,"isDefault":%s,"entries":[%s]}',
            json_string(name, 64), json_string(record.tag or "", 32),
            tonumber(record.weight) or 0, record.is_default == "true" and "true" or "false",
            table.concat(entries, ","))
    end
    return true, nil, { { "groups", { raw = "[" .. table.concat(parts, ",") .. "]" } } }
end

-- Tags keep their own capability names; underneath they are the bridge.tags
-- collection like everything else.
IMPL["player.set_tag"] = function(_state, p, _finish, raw)
    local uid = raw.userid or ""
    tags:set(uid .. "\30" .. tostring(p.key), { uid = uid, key = p.key, value = p.value })
    return true, nil, { { "key", p.key }, { "value", p.value } }
end

IMPL["player.get_tag"] = function(_state, p, _finish, raw)
    local record = tags:get((raw.userid or "") .. "\30" .. tostring(p.key))
    return true, nil, { { "key", p.key }, { "value", record and record.value or nil } }
end

IMPL["player.delete_tag"] = function(_state, p, _finish, raw)
    local removed = tags:delete((raw.userid or "") .. "\30" .. tostring(p.key))
    return true, nil, { { "key", p.key }, { "removed", removed == true } }
end


IMPL["location.save"] = function(_state, p)
    locations:set(p.name, { x = p.x, y = p.y, z = p.z, source = "manual" })
    return true, nil, { { "name", p.name } }
end

IMPL["location.list"] = function()
    local parts = {}
    local names = {}
    for name in pairs(locations:all()) do names[#names + 1] = name end
    table.sort(names)
    for _, name in ipairs(names) do
        local r = locations:get(name)
        parts[#parts + 1] = string.format('{"name":%s,"x":%s,"y":%s,"z":%s,"source":%s,"species":%s}',
            json_string(name, 96), tostring(tonumber(r.x) or 0), tostring(tonumber(r.y) or 0),
            tostring(tonumber(r.z) or 0), json_string(r.source or "manual", 16),
            json_string(r.species or "", 64))
    end
    return true, nil, { { "locations", { raw = "[" .. table.concat(parts, ",") .. "]" } } }
end

IMPL["location.delete"] = function(_state, p)
    if not locations:delete(p.name) then return false, "unknown_location", {} end
    return true, nil, { { "name", p.name } }
end

-- ── collections over the wire ───────────────────────────────────────────────
-- The generic door onto everything stored. A caller that has never heard of a
-- collection can list what exists, read its shape, and edit it — which is what
-- lets the panel show a mod's data without being taught about the mod.

local COLLECTION_RESERVED = { id = true, action = true, userid = true, collection = true, record = true }

local function collection_or_error(name)
    local spec = Collections.spec(tostring(name or ""))
    if not spec then return nil, "unknown_collection: " .. tostring(name) end
    return Collections.open(spec.qualified), spec
end

local function record_json(fields)
    if fields == nil then return "null" end
    local parts = {}
    for _, key in ipairs((function()
        local keys = {}
        for k in pairs(fields) do keys[#keys + 1] = k end
        table.sort(keys)
        return keys
    end)()) do
        local value = fields[key]
        if type(value) == "table" then
            local items = {}
            for _, item in ipairs(value) do items[#items + 1] = json_string(item, MAX_TEXT) end
            parts[#parts + 1] = json_string(key, 64) .. ":[" .. table.concat(items, ",") .. "]"
        else
            parts[#parts + 1] = json_string(key, 64) .. ":" .. json_string(value, MAX_TEXT)
        end
    end
    return "{" .. table.concat(parts, ",") .. "}"
end

IMPL["data.collections"] = function()
    local parts = {}
    for _, c in ipairs(Collections.all()) do
        local fields = {}
        for field, kind in pairs(c.fields or {}) do
            fields[#fields + 1] = json_string(field, 48) .. ":" .. json_string(kind, 24)
        end
        table.sort(fields)
        parts[#parts + 1] = string.format(
            '{"name":%s,"owner":%s,"description":%s,"storage":%s,"file":%s,"count":%d,"fields":{%s}}',
            json_string(c.qualified, 96), json_string(c.owner, 32),
            json_string(c.description or "", 200), json_string(c.storage, 8),
            c.file and json_string(c.file, 64) or "null", c.count, table.concat(fields, ","))
    end
    return true, nil, { { "collections", { raw = "[" .. table.concat(parts, ",") .. "]" } } }
end

IMPL["data.list"] = function(_state, p)
    local handle, err = collection_or_error(p.collection)
    if not handle then return false, err, {} end
    local parts, count = {}, 0
    local ids = {}
    for id in pairs(handle:all()) do ids[#ids + 1] = id end
    table.sort(ids)
    for _, id in ipairs(ids) do
        parts[#parts + 1] = json_string(id, 128) .. ":" .. record_json(handle:get(id))
        count = count + 1
    end
    return true, nil, {
        { "collection", p.collection },
        { "count", count },
        { "records", { raw = "{" .. table.concat(parts, ",") .. "}" } },
    }
end

IMPL["data.get"] = function(_state, p)
    local handle, err = collection_or_error(p.collection)
    if not handle then return false, err, {} end
    return true, nil, { { "record", { raw = record_json(handle:get(p.record)) } } }
end

IMPL["data.set"] = function(_state, p, _finish, raw)
    local handle, err = collection_or_error(p.collection)
    if not handle then return false, err, {} end
    local fields = {}
    for key, value in pairs(raw or {}) do
        if not COLLECTION_RESERVED[key] then fields[key] = value end
    end
    if not handle:set(p.record, fields) then return false, "write_failed", {} end
    return true, nil, { { "collection", p.collection }, { "record", p.record } }
end

IMPL["data.delete"] = function(_state, p)
    local handle, err = collection_or_error(p.collection)
    if not handle then return false, err, {} end
    return true, nil, { { "removed", handle:delete(p.record) == true } }
end

-- ── action dispatch ─────────────────────────────────────────────────────────
-- One path for both doors: the action file the daemon writes, and a mod in
-- this state calling pal.call. `report` receives (ok, err, data, subject) when
-- the engine has answered, which is later than the return — actions run on the
-- game thread, and some of them defer beyond that.
local function invoke(action_type, userid, raw, report)
    local spec = CAPS.actions[action_type]
    local handler = IMPL[action_type]
    if not spec or not handler then
        report(false, "unknown_action", {}, nil)
        return
    end
    local params, invalid = validate(spec.params, raw)
    if not params then
        report(false, invalid, {}, nil)
        return
    end

    -- Handlers read their target from raw.userid. The action queue carries
    -- it inside the line; a chat command or a mod carries it as the argument
    -- — make the two indistinguishable.
    if raw.userid == nil then
        local carried = { userid = userid }
        for key, value in pairs(raw) do carried[key] = value end
        raw = carried
    end

    -- Whether a player has to be online for this action is the manifest's
    -- answer, not a guess from the type name: some actions take a player when
    -- one is given and work without one otherwise.
    local needs_player = spec.target == "player" and not spec.target_optional
    local function execute()
        local state = nil
        if needs_player then
            state = find_player_state(userid)
            if not state then
                report(false, "player_offline", {}, nil)
                return
            end
        elseif userid and userid ~= "" then
            state = find_player_state(userid)
        end
        local subject = state and player_subject(state) or nil
        local function finish(ok_value, err_value, data_value)
            report(ok_value == true, err_value, data_value, subject)
        end
        -- A handler returning "deferred" publishes its own result later: the
        -- only way pal.spawn can report an id the engine has not assigned yet.
        local ok, result, err, data = pcall(handler, state, params, finish, raw)
        if not ok then
            finish(false, tostring(result), {})
            return
        end
        if result == "deferred" then return end
        finish(result, err, data)
    end
    if type(ExecuteInGameThread) == "function" then
        ExecuteInGameThread(execute)
    else
        execute()
    end
end

local function run_action(request)
    local action_type = request.action or ""
    invoke(action_type, request.userid, request, function(ok, err, data, subject)
        publish_result(request.id or "", action_type, ok, err, subject, data or {})
    end)
end

local function parse_request(line)
    local fields = {}
    for chunk in line:gmatch("[^\t]+") do
        local key, value = chunk:match("^([%w_]+)=(.*)$")
        if key then fields[key] = value end
    end
    return fields
end

local action_offset = 0

local function poll_actions()
    local file = io.open(ACTION_FILE, "r")
    if not file then return end
    local size = file:seek("end")
    if size < action_offset then action_offset = 0 end -- emptied at boot
    file:seek("set", action_offset)
    for line in file:lines() do
        action_offset = action_offset + #line + 1
        if line ~= "" then
            local request = parse_request(line)
            if request.action then guard("action " .. request.action, run_action, request) end
        end
    end
    file:close()
end

-- ── hook registration (targets come from the generated table) ───────────────
local HOOK_IMPL = {
    ["/Script/Pal.PalPlayerController:EnterChat_Receive"] = on_chat,
    ["/Script/Pal.PalPlayerCharacter:OnCompleteInitializeParameter"] = on_character_init,
    ["/Script/Pal.PalCharacter:OnDeadCharacter"] = on_death,
    ["/Script/Pal.PalCharacterParameterComponent:OnInitialize_AfterSetIndividualParameter"] = on_param_init,
}

local function announce_hook(event_type, target, ok)
    publish("bridge.hook", BRIDGE_SUBJECT, {
        { "hook", event_type }, { "target", target }, { "ok", ok },
    })
end

local function supported(target)
    return target:sub(1, 6) ~= "/Game/" -- Blueprint targets fault this loader
end

local function register(target, types, attempt)
    if not supported(target) or not HOOK_IMPL[target] then
        for _, t in ipairs(types) do announce_hook(t, target, false) end
        info("hook skipped, no native implementation for " .. target)
        return
    end
    local handler = HOOK_IMPL[target]
    local ok = pcall(RegisterHook, target, function(...)
        guard("hook " .. target, handler, ...)
    end)
    if ok then
        for _, t in ipairs(types) do announce_hook(t, target, true) end
        info(string.format("hook registered on %s (%s)", target, table.concat(types, ", ")))
        return
    end
    if attempt < HOOK_RETRY_LIMIT and type(ExecuteWithDelay) == "function" then
        ExecuteWithDelay(HOOK_RETRY_MS, function() register(target, types, attempt + 1) end)
        return
    end
    for _, t in ipairs(types) do announce_hook(t, target, false) end
    info("hook could NOT be registered on " .. target)
end

local function register_all()
    -- Several event types can share one engine hook; register each hook once.
    local by_target, order = {}, {}
    for _, event in ipairs(CAPS.events) do
        if not by_target[event.hook] then
            by_target[event.hook] = {}
            order[#order + 1] = event.hook
        end
        table.insert(by_target[event.hook], event.type)
    end
    for _, target in ipairs(order) do
        guard("hook registration", register, target, by_target[target], 1)
    end
end

-- ── boot ────────────────────────────────────────────────────────────────────
guard("event file init", append_line, "")

publish("bridge.ready", BRIDGE_SUBJECT, {
    { "agent", MOD },
    { "version", VERSION },
    { "envelope", CAPS.envelope },
})

if type(ExecuteWithDelay) == "function" then
    ExecuteWithDelay(1000, register_all)
else
    register_all()
end

-- Mods are loaded into this state and driven from here: every capability
-- above is theirs to call, and the registry snapshot is how anything outside
-- the game learns what they added.
-- What a mod may hold a handler for: everything with a hook, plus the ones the
-- agent produces without one.
local PUBLISHED = { ["player.leave"] = true, ["bridge.ready"] = true, ["bridge.hook"] = true,
                    ["player.hour"] = true, ["clock.minute"] = true, ["clock.day"] = true }
for _, event in ipairs(CAPS.events or {}) do PUBLISHED[event.type] = true end

framework.init({
    info = info,
    call = invoke,
    event_types = PUBLISHED,
    capabilities = CAPS.actions,
    collections = Collections,
    home_for = home_for,
    tags = tags,
    root = PAL_ROOT,
    mods_dir = MODS_DIR,
    json_string = json_string,
    agent = MOD,
    permissions = perms,
    player_by_name = player_by_name,
})
guard("mod loading", framework.load)
guard("mod registry snapshot", framework.snapshot)

if type(LoopAsync) == "function" then
    local LEAVE_SCAN_TICKS = math.max(1, math.floor(LEAVE_SCAN_MS / ACTION_POLL_MS))
    local PLAYTIME_TICKS = math.max(1, math.floor(60000 / ACTION_POLL_MS))
    local tick = 0
    LoopAsync(ACTION_POLL_MS, function()
        guard("action poll", poll_actions)
        guard("mod dispatch", framework.drain)
        tick = tick + 1
        -- An operator editing permissions.config by hand is meant to work, so
        -- the config files are re-read on the same cadence as the leave scan.
        if tick % LEAVE_SCAN_TICKS == 0 then guard("config reload", Collections.reload_changed) end
        if tick % LEAVE_SCAN_TICKS == 0 then guard("settings reload", framework.reload_settings) end
        if tick % LEAVE_SCAN_TICKS == 0 then guard("clock", publish_clock) end
        if tick % PLAYTIME_TICKS == 0 then guard("playtime credit", credit_playtime) end
        if tick % LEAVE_SCAN_TICKS == 0 then
            -- Enumerating actors is engine work, so it goes where every other
            -- engine call in this file goes.
            if type(ExecuteInGameThread) == "function" then
                ExecuteInGameThread(function() guard("leave scan", scan_for_leaves) end)
            else
                guard("leave scan", scan_for_leaves)
            end
        end
        return false
    end)
else
    info("LoopAsync unavailable — actions cannot be executed")
end

info(string.format("v%s loaded (envelope %d), events -> %s", VERSION, CAPS.envelope, EVENT_FILE))
info(string.format("state root %s (%s)", PAL_ROOT, ROOT_SOURCE))
info(string.format("each mod keeps its files in %s/<Mod>/",
    MODS_SOURCE or MODS_DIR))
info(string.format("mods from %s (%s)", MODS_DIR, MODS_DIR_SOURCE))
