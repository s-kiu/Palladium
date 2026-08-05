-- PalBridgeAgent — the in-game half of the pal-up bridge.
--
-- Publishes engine events onto the shared volume as JSON lines, and executes
-- actions handed to it the same way. UE4SS Lua has no sockets, so files on the
-- volume are the only transport in either direction.
--
--   out: /palworld/logs/bridge-events.jsonl    JSON, one object per line
--   in:  /palworld/.state/bridge-actions.jsonl tab-separated key=value lines
--
-- Both files are emptied by serve.sh at boot, so offsets into them are only
-- meaningful within one server run.
--
-- Event schema v1: every line carries v, at and type; the remaining fields
-- depend on type. Fields are only ever added, never removed or retyped.
--
-- Hooks are the fragile part by design — engine function names move between
-- game builds. Each one registers independently and reports itself as a `hook`
-- event, so a name that goes stale costs that one event type and nothing else.
-- Targets below verified against Palworld v1.0.2.101103 (Steam build 24466863).

local MOD = "PalBridgeAgent"
local VERSION = "1.1.0"
local SCHEMA_VERSION = 1

local PAL_ROOT = os.getenv("PAL_ROOT") or "/palworld"
local EVENT_FILE = PAL_ROOT .. "/logs/bridge-events.jsonl"
local ACTION_FILE = PAL_ROOT .. "/.state/bridge-actions.jsonl"

-- Player input reaches the event file through chat, so every string written is
-- capped. The caps also bound the size of a single line for readers.
local MAX_TEXT = 512

local HOOK_RETRY_MS = 2000
local HOOK_RETRY_LIMIT = 15
local ACTION_POLL_MS = 500
-- Character parameters re-initialise on respawn as well as on connect; a
-- second init for a player already known is a respawn, not a join.
local JOIN_DEDUP_SECONDS = 30
local MAX_ITEM_COUNT = 9999

local function info(text)
    print(string.format("[%s] %s\n", MOD, text))
end

-- Nothing the bridge does may propagate into the game thread: report once to
-- UE4SS.log and carry on.
local function guard(what, fn, ...)
    local ok, err = pcall(fn, ...)
    if not ok then
        info(string.format("%s failed: %s", what, tostring(err)))
    end
    return ok
end

-- ── JSON ────────────────────────────────────────────────────────────────────
-- The UE4SS Lua runtime has no JSON library. Events are flat objects of
-- strings, numbers and booleans, so an escaper and a value formatter are the
-- whole encoder.
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

local function json_value(value)
    local kind = type(value)
    if kind == "boolean" then return value and "true" or "false" end
    if kind == "number" then
        if value % 1 == 0 then return string.format("%d", value) end
        return string.format("%.6g", value)
    end
    return json_string(value)
end

-- ── event file ──────────────────────────────────────────────────────────────
-- Single writer, one line per io.write, handle closed immediately: short
-- appends to a local file land atomically enough for readers tailing it.
local function append_line(line)
    local file, err = io.open(EVENT_FILE, "a")
    if not file then
        error(string.format("cannot open %s: %s", EVENT_FILE, tostring(err)), 0)
    end
    file:write(line)
    file:close()
end

-- `fields` is an ordered list of {key, value} so lines stay stable and
-- diffable rather than following Lua's table iteration order.
local function emit(event_type, fields)
    local parts = {
        '{"v":', tostring(SCHEMA_VERSION),
        ',"at":', string.format("%d", os.time()),
        ',"type":', json_string(event_type, 32),
    }
    for _, field in ipairs(fields or {}) do
        parts[#parts + 1] = "," .. json_string(field[1], 32) .. ":" .. json_value(field[2])
    end
    parts[#parts + 1] = "}\n"
    append_line(table.concat(parts))
end

local function publish(event_type, fields)
    guard("emit " .. event_type, emit, event_type, fields)
end

-- ── engine value extraction ─────────────────────────────────────────────────
-- Hook parameters arrive wrapped, and payload shapes vary with the game build,
-- so every access is probed rather than assumed.
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

-- PlayerUId is an FGuid; its four words rendered as the dashed form the game's
-- REST API and the panel both key on.
local function player_userid(state)
    if state == nil then return "" end
    local uid = member(state, "PlayerUId")
    if uid == nil then return "" end
    local ok, text = pcall(function()
        return string.format("%08X-%08X-%08X-%08X", uid.A or 0, uid.B or 0, uid.C or 0, uid.D or 0)
    end)
    if ok and text and text ~= "00000000-00000000-00000000-00000000" then return text end
    return ""
end

local function state_of(character)
    local state = member(character, "PlayerState")
    if valid(state) then return state end
    return nil
end

-- ── session tracking ────────────────────────────────────────────────────────
-- Character parameters re-initialise on respawn too, so joins are deduplicated
-- against who is already known to be on.
local online = {} -- userid → { name, at }

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
    publish("chat", {
        { "player", player_name(state) },
        { "userid", player_userid(state) },
        { "message", message },
    })
end

local function on_join(context)
    local character = unwrap(context)
    if not valid(character) then return end
    local state = state_of(character)
    if not state then
        -- PlayerState is attached a moment after the character initialises.
        if type(ExecuteWithDelay) == "function" then
            ExecuteWithDelay(50, function() guard("join retry", on_join, context) end)
        end
        return
    end

    local name, userid = player_name(state), player_userid(state)
    local now = os.time()
    local known = online[userid]
    if known and (now - known.at) < JOIN_DEDUP_SECONDS then
        known.at = now
        return
    end

    -- `initial` is scoped to this server run; the panel keeps the persistent
    -- first-seen record because the event file starts empty every boot.
    publish("join", {
        { "player", name },
        { "userid", userid },
        { "initial", known == nil },
    })
    online[userid] = { name = name, at = now }
end

local function on_death(_, event)
    local dead_info = unwrap(event)
    if dead_info == nil then return end
    local victim = member(dead_info, "SelfActor")
    if not valid(victim) then return end
    -- Pals die constantly; only characters carrying a PlayerState are players.
    local victim_state = state_of(victim)
    if not victim_state then return end

    local fields = {
        { "player", player_name(victim_state) },
        { "userid", player_userid(victim_state) },
    }
    -- Attribution is best-effort: the last attacker may be a pal, the world, or
    -- already gone by the time this fires.
    local attacker = member(dead_info, "LastAttacker")
    if valid(attacker) then
        local ok, controller = pcall(GetOwnerController, attacker)
        if ok and valid(controller) then
            local killer_state = member(controller, "PlayerState")
            if valid(killer_state) then
                fields[#fields + 1] = { "killer", player_name(killer_state) }
                fields[#fields + 1] = { "killerUserid", player_userid(killer_state) }
            end
        end
    end
    publish("death", fields)
end

-- ── actions ─────────────────────────────────────────────────────────────────
-- Requests are written by the panel, never by players. The format is
-- tab-separated key=value rather than JSON so that parsing them needs no
-- parser: there is no structure here for a malformed line to exploit.
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

local ACTIONS = {}

function ACTIONS.give_item(request)
    local item = request.item or ""
    if not item:match("^[%w_]+$") then return false, "invalid item id" end
    local count = math.floor(tonumber(request.count) or 1)
    if count < 1 or count > MAX_ITEM_COUNT then return false, "count out of range" end

    local state = find_player_state(request.userid)
    if not state then return false, "player not online" end
    local inventory = state:GetInventoryData()
    if not inventory then return false, "no inventory data" end

    inventory:AddItem_ServerInternal(FName(item), count, false, 0.0, true)
    return true, string.format("%s x%d", item, count)
end

function ACTIONS.message(request)
    local text = (request.text or ""):sub(1, MAX_TEXT)
    if text == "" then return false, "empty message" end

    local state = find_player_state(request.userid)
    if not state then return false, "player not online" end
    local util = pal_utility()
    local world = FindFirstOf("World")
    if not util or not valid(world) then return false, "world not ready" end

    local uid = member(state, "PlayerUId")
    if uid == nil then return false, "no player uid" end
    util:SendSystemToPlayerChat(world, text, { { A = uid.A, B = uid.B, C = uid.C, D = uid.D } })
    return true, "delivered"
end

local function run_action(request)
    local handler = ACTIONS[request.action or ""]
    if not handler then
        publish("action", {
            { "id", request.id or "" },
            { "action", request.action or "" },
            { "ok", false },
            { "detail", "unknown action" },
        })
        return
    end
    -- Everything below touches UObjects, which is only legal on the game
    -- thread; the result is published from inside that callback.
    local function execute()
        local ok, result, detail = pcall(handler, request)
        if not ok then
            result, detail = false, tostring(result)
        end
        publish("action", {
            { "id", request.id or "" },
            { "action", request.action },
            { "userid", request.userid or "" },
            { "ok", result == true },
            { "detail", tostring(detail or "") },
        })
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

-- ── registration ────────────────────────────────────────────────────────────
-- Native targets only — see `supported` above for why. Leave events come from
-- the panel watching the game's own player list instead; nothing in /Script/
-- exposes a disconnect that can be hooked here.
local HOOKS = {
    { name = "chat", target = "/Script/Pal.PalPlayerController:EnterChat_Receive", handler = on_chat },
    { name = "join", target = "/Script/Pal.PalPlayerCharacter:OnCompleteInitializeParameter", handler = on_join },
    { name = "death", target = "/Script/Pal.PalCharacter:OnDeadCharacter", handler = on_death },
}

-- Blueprint function targets (/Game/...) are not hookable on this UE4SS build,
-- and finding that out the wrong way costs the server: RegisterHook against a
-- Blueprint class that is not loaded yet faults the process, which pcall cannot
-- catch, and once the class *is* loaded RegisterHook rejects it anyway. Looking
-- a UFunction path up with StaticFindObject faults just the same. So the rule
-- is native targets only, enforced here rather than left to a future edit.
local function supported(target)
    return target:sub(1, 6) ~= "/Game/"
end

local function announce_hook(hook, ok, state)
    publish("hook", {
        { "hook", hook.name },
        { "target", hook.target },
        { "ok", ok },
        { "state", state },
    })
end

local function register(hook, attempt)
    if not supported(hook.target) then
        announce_hook(hook, false, "unsupported")
        info(string.format("hook '%s' skipped: %s is not a native target", hook.name, hook.target))
        return
    end
    local ok = pcall(RegisterHook, hook.target, function(...)
        guard(hook.name .. " event", hook.handler, ...)
    end)
    if ok then
        announce_hook(hook, true, "live")
        info(string.format("hook '%s' registered on %s", hook.name, hook.target))
        return
    end
    if attempt < HOOK_RETRY_LIMIT and type(ExecuteWithDelay) == "function" then
        ExecuteWithDelay(HOOK_RETRY_MS, function() register(hook, attempt + 1) end)
        return
    end
    announce_hook(hook, false, "failed")
    info(string.format("hook '%s' could NOT be registered on %s", hook.name, hook.target))
end

-- Create the event file at load so consumers can tail it before anything
-- happens in game.
guard("event file init", append_line, "")

publish("ready", {
    { "agent", MOD },
    { "version", VERSION },
    { "schema", SCHEMA_VERSION },
    { "actions", "give_item,message" },
})

-- Give UE4SS a moment to finish standing up before touching the object system.
local function register_all()
    for _, hook in ipairs(HOOKS) do
        guard("hook registration", register, hook, 1)
    end
end

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

-- UE4SS.log is not written as UTF-8; keep diagnostics ASCII-only.
info(string.format("v%s loaded, events -> %s", VERSION, EVENT_FILE))
