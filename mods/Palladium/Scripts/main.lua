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
--   - everything runs under pcall; a bridge bug drops an event, never the game

local MOD = "Palladium"
local VERSION = "2.5.0"

local CAPS = require("generated/capabilities")

local PAL_ROOT = os.getenv("PAL_ROOT") or "/palworld"
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

local function publish(event_type, subject_json, data_fields)
    guard("emit " .. event_type, emit, "event", event_type, subject_json, data_fields)
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

local function player_subject(state)
    return '{"kind":"player","id":' .. json_string(player_userid(state), 64)
        .. ',"name":' .. json_string(player_name(state), 64) .. "}"
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
    publish("player.chat", player_subject(state), { { "message", message } })
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
        publish("player.respawn", player_subject(state), {})
        return
    end
    if online[userid] and (now - online[userid]) < JOIN_DEDUP_SECONDS then
        online[userid] = now
        return
    end

    online[userid] = now
    publish("player.join", player_subject(state), {
        { "firstThisRun", seen_this_run[userid] == nil },
    })
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
    publish("player.death", player_subject(victim_state), data)
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
    publish("npc.spawn", pal_subject(species, location, pal_id_of(parameter)), {
        { "species", species },
        { "level", type(level) == "number" and level or 0 },
        { "rare", member(save, "IsRarePal") == true },
    })
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
                if spec.min and value < spec.min then return nil, "invalid_params: " .. spec.name .. " out of range" end
                if spec.max and value > spec.max then return nil, "invalid_params: " .. spec.name .. " out of range" end
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

-- Each handler: (state, params) → ok, error?, data_fields?
local IMPL = {}

IMPL["player.message"] = function(state, p)
    local util = pal_utility()
    local world = FindFirstOf("World")
    if not util or not valid(world) then return false, "not_supported" end
    local uid = member(state, "PlayerUId")
    if uid == nil then return false, "player_offline" end
    util:SendSystemToPlayerChat(world, p.text, { { A = uid.A, B = uid.B, C = uid.C, D = uid.D } })
    return true, nil, {}
end

IMPL["player.give_item"] = function(state, p)
    local inventory = state:GetInventoryData()
    if not inventory then return false, "player_offline" end
    inventory:AddItem_ServerInternal(FName(p.item), p.count, false, 0.0, true)
    return true, nil, { { "item", p.item }, { "count", p.count } }
end

IMPL["player.teleport"] = function(state, p)
    local _, pawn = pawn_of(state)
    if not pawn then return false, "player_offline" end
    local ok, moved = pcall(function()
        return pawn:K2_TeleportTo({ X = p.x, Y = p.y, Z = p.z }, { Pitch = 0, Yaw = 0, Roll = 0 })
    end)
    if not ok then return false, "not_supported" end
    if moved == false then return false, "teleport_blocked" end
    return true, nil, { { "x", p.x }, { "y", p.y }, { "z", p.z } }
end

IMPL["player.heal"] = function(state)
    local util = pal_utility()
    local _, pawn = pawn_of(state)
    if not util or not pawn then return false, "player_offline" end
    local world = FindFirstOf("World")
    -- Signature unproven on this build: probe the two plausible shapes.
    local ok = pcall(function() util:FullRecoveryHP(world, pawn) end)
    if not ok then
        ok = pcall(function() util:FullRecoveryHP(pawn) end)
    end
    if not ok then return false, "not_supported" end
    return true, nil, {}
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

IMPL["pal.spawn"] = function(state, p, finish)
    local util = pal_utility()
    local controller, pawn = pawn_of(state)
    if not util or not valid(controller) then return false, "player_offline" end

    local manager = util:GetNPCManager(controller)
    if not valid(manager) then return false, "spawn_failed" end

    -- Which AI controller a spawn gets is what decides whether it fights.
    -- NPCAIControllerBaseClass — the one the community spawn recipe uses — has
    -- no combat brain, which is why those pals stand there. The manager also
    -- exposes monster/enemy controller classes; prefer those when hostile is
    -- asked for, and report which one actually applied.
    local controller_class, controller_kind
    if p.hostile then
        for _, field in ipairs({ "MonsterAIControllerClass", "EnemyAIControllerClass" }) do
            local candidate = member(manager, field)
            if valid(candidate) then
                controller_class, controller_kind = candidate, field
                break
            end
        end
    end
    if not controller_class then
        controller_class = member(manager, "NPCAIControllerBaseClass")
        controller_kind = "NPCAIControllerBaseClass"
        if p.hostile then
            info("no monster/enemy AI controller class on the NPC manager — spawning passive")
        end
    end
    if not valid(controller_class) then return false, "spawn_failed" end

    local location
    if p.x and p.y and p.z then
        location = { X = p.x, Y = p.y, Z = p.z }
    else
        if not pawn then return false, "player_offline" end
        local at = pawn:K2_GetActorLocation()
        location = { X = at.X + 300, Y = at.Y, Z = at.Z + 100 }
    end

    local handle = manager:SpawnNPCForServer({
        ControllerClass = controller_class,
        CharacterID = FName(p.species),
        Level = p.level,
        Location = location,
        Yaw = 0.0,
        Squad = nil,
    }, nil)
    if not valid(handle) then return false, "spawn_failed" end

    -- Rarity and traits apply to the individual parameter once it exists.
    if p.rare or (p.traits and p.traits ~= "") then
        local function configure(attempt)
            if not valid(handle) then return end
            local parameter = handle:TryGetIndividualParameter()
            if not valid(parameter) then
                if attempt < 5 and type(ExecuteWithDelay) == "function" then
                    ExecuteWithDelay(250, function() configure(attempt + 1) end)
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
    -- The individual parameter (and with it the pal's id) exists a moment
    -- after the spawn call; wait for it so the caller gets an id it can act on
    -- straight away rather than having to correlate the npc.spawn event.
    local function settle(attempt)
        local pal_id = valid(handle) and pal_id_of(handle:TryGetIndividualParameter()) or ""
        if pal_id == "" and attempt < 6 and type(ExecuteWithDelay) == "function" then
            ExecuteWithDelay(250, function() guard("pal.spawn settle", settle, attempt + 1) end)
            return
        end
        finish(true, nil, {
            { "pal", pal_id },
            { "species", p.species },
            { "level", p.level },
            { "hostile", controller_kind ~= "NPCAIControllerBaseClass" },
            { "controller", controller_kind },
        })
    end
    guard("pal.spawn settle", settle, 1)
    return "deferred"
end

-- Numbers arrive raw or wrapped in a fixed-point struct depending on the
-- field; unwrap both shapes.
local function as_number(value)
    if type(value) == "number" then return value end
    local inner = member(value, "Value")
    if type(inner) == "number" then return inner end
    return nil
end

-- Getters live on the character, its parameter component, or the individual
-- parameter depending on the stat and the build — try each, take the first
-- that answers with a number.
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

local STAT_GETTERS = {
    { "hp", "GetHP" }, { "maxHp", "GetMaxHP" },
    { "hunger", "GetFullStomach" }, { "maxHunger", "GetMaxFullStomach" },
    { "shield", "GetShieldValue" }, { "maxShield", "GetShieldMaxHP" },
    { "sanity", "GetSanityValue" }, { "level", "GetLevel" },
}

local function read_stats(character)
    local component = member(character, "CharacterParameterComponent")
    local parameter = pal_parameter(character)
    local sources = { character, component, parameter }
    local parts = {}
    for _, entry in ipairs(STAT_GETTERS) do
        local value = stat_of(sources, entry[2])
        parts[#parts + 1] = json_string(entry[1], 24) .. ":" ..
            (value and json_value(value) or "null")
    end
    if not stat_of(sources, "GetLevel") then
        local save = parameter and member(parameter, "SaveParameter")
        local level = save and member(save, "Level")
        if type(level) == "number" then
            parts[#parts] = json_string("level", 24) .. ":" .. json_value(level)
        end
    end
    return "{" .. table.concat(parts, ",") .. "}"
end

-- Applies whichever stats were supplied; a field left out is left alone.
local function write_stats(character, p)
    local util = pal_utility()
    if not util then return false, "not_supported" end
    local applied, failed = {}, {}
    local function attempt(label, ...)
        local shapes = { ... }
        for _, shape in ipairs(shapes) do
            if pcall(shape) then
                applied[#applied + 1] = label
                return
            end
        end
        failed[#failed + 1] = label
    end
    if p.hp ~= nil then
        attempt("hp",
            function() util:SetHPByRateToCharacter(character, p.hp) end,
            function() util:SetHPByRateToCharacter(FindFirstOf("World"), character, p.hp) end)
    end
    if p.hunger ~= nil then
        attempt("hunger",
            function() util:SetFullStomach(character, p.hunger) end,
            function() util:SetFullStomach(FindFirstOf("World"), character, p.hunger) end)
    end
    if p.maxShield ~= nil then
        attempt("maxShield", function() util:SetShieldMaxHP(character, p.maxShield) end)
    end
    if p.shield ~= nil then
        attempt("shield", function() util:SetShieldHP(character, p.shield) end)
    end
    if #applied == 0 and #failed > 0 then return false, "not_supported" end
    return true, nil, {
        { "applied", table.concat(applied, ",") },
        { "failed", table.concat(failed, ",") },
        { "stats", { raw = read_stats(character) } },
    }
end

IMPL["player.stats"] = function(state)
    local _, pawn = pawn_of(state)
    if not pawn then return false, "player_offline" end
    return true, nil, { { "stats", { raw = read_stats(pawn) } } }
end

IMPL["player.set_stats"] = function(state, p)
    local _, pawn = pawn_of(state)
    if not pawn then return false, "player_offline" end
    return write_stats(pawn, p)
end

-- ── pals in the world ───────────────────────────────────────────────────────
local function world_pals()
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

local function find_pal(pal_id)
    for _, pal in ipairs(world_pals()) do
        if pal.id ~= "" and pal.id == pal_id then return pal end
    end
    return nil
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

-- ── action dispatch ─────────────────────────────────────────────────────────
local function run_action(request)
    local action_type = request.action or ""
    local spec = CAPS.actions[action_type]
    local handler = IMPL[action_type]
    if not spec or not handler then
        publish_result(request.id or "", action_type, false, "unknown_action", nil, {})
        return
    end
    local params, invalid = validate(spec.params, request)
    if not params then
        publish_result(request.id or "", action_type, false, invalid, nil, {})
        return
    end

    local needs_player = action_type:sub(1, 4) ~= "pal."
    local function execute()
        local state = nil
        if needs_player then
            state = find_player_state(request.userid)
            if not state then
                publish_result(request.id or "", action_type, false, "player_offline", nil, {})
                return
            end
        elseif request.userid and request.userid ~= "" then
            state = find_player_state(request.userid)
        end
        local subject = state and player_subject(state) or nil
        local function finish(ok_value, err_value, data_value)
            publish_result(request.id or "", action_type, ok_value == true, err_value, subject, data_value)
        end
        -- A handler returning "deferred" publishes its own result later: the
        -- only way pal.spawn can report an id the engine has not assigned yet.
        local ok, result, err, data = pcall(handler, state, params, finish)
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

if type(LoopAsync) == "function" then
    LoopAsync(ACTION_POLL_MS, function()
        guard("action poll", poll_actions)
        return false
    end)
else
    info("LoopAsync unavailable — actions cannot be executed")
end

info(string.format("v%s loaded (envelope %d), events -> %s", VERSION, CAPS.envelope, EVENT_FILE))
