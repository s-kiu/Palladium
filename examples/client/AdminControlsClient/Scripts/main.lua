-- AdminControlsClient — the half of Palladium that has to run on the player.
--
-- Everything else in this project runs on the server, and that is why some
-- admin commands cannot work. Palworld simulates the player on the player's
-- own machine: flight is a movement mode the client enters, stamina is a bar
-- the client draws. A server can set its own copy of either and the player
-- will never see it. Measured, not assumed — the server's stamina reads full
-- while the player's bar empties.
--
-- So this mod runs on the game client, listens for instructions from the
-- server, and applies them locally.
--
-- The channel is chat, because chat is the only thing a server can already
-- send to one specific player without the two sides sharing custom netcode.
-- The agent sends a line nobody is meant to read:
--
--     [[PAL:fly:on]]
--
-- and this mod acts on it. It does not hide it: blanking the message inside
-- the multicast that carries it crashed the game, so the line stays visible
-- and the wiring shows. A visible oddity beats a crash.
--
-- The hook is BroadcastChatMessage on the game state, not EnterChat_Receive on
-- the controller. That distinction cost an evening: EnterChat_Receive is
-- declared `Server`, so it runs where a message is *sent* and never on the
-- machine receiving one. BroadcastChatMessage is the NetMulticast that
-- actually arrives here, and it carries an FPalChatMessage with the text in
-- its Message field.
--
-- Install: this is an ordinary UE4SS Lua mod for the *game*, not for the
-- server. See the README beside this file.

local NAME = "AdminControlsClient"
local TOKEN = "%[%[PAL:([a-z_]+):([a-z]+)%]%]"

local function log(text)
    print(string.format("[%s] %s\n", NAME, tostring(text)))
end

-- ── the local pawn ──────────────────────────────────────────────────────────
-- On a client there is exactly one player controller worth having: the local
-- one. FindFirstOf answers with it because a client only ever owns its own.

local function local_pawn()
    local controller = FindFirstOf("PalPlayerController")
    if not controller or not controller:IsValid() then return nil end
    local ok, pawn = pcall(function() return controller.Pawn end)
    if not ok or not pawn or not pawn:IsValid() then return nil end
    return pawn, controller
end

-- ── flight ──────────────────────────────────────────────────────────────────
-- Two routes, cheapest first. ClientCheatFly is Unreal's own and needs the
-- cheat manager, which a normal client does not have — so the movement mode is
-- set directly as the route that does not depend on one.
--
-- MOVE_Flying is 5 in Unreal's EMovementMode. Setting it on the client is the
-- whole point: this is the machine that decides where the player is.

local MOVE_FLYING, MOVE_WALKING = 5, 1
local GRAVITY_FLAG = "Palladium_Fly"
local flying = false

-- Three things have to be true at once, which is why setting the movement mode
-- alone only moved the camera: the mode says "flying", gravity has to stop
-- pulling, and on a build with a cheat manager Unreal's own Fly() sets up the
-- rest (collision, braking) better than we can by hand.
--
-- Each step is tried and reported separately. A half-working flight is worth
-- knowing about in detail, because the half that works names the half that
-- does not.
local function set_flying(on)
    local pawn, controller = local_pawn()
    if not pawn then
        log("no local pawn yet — are you in the world?")
        return false
    end
    local movement = pawn.CharacterMovement
    if not movement or not movement:IsValid() then
        log("no movement component on the local pawn")
        return false
    end

    local done = {}

    -- 1. The flag that makes it stick. Unreal's movement component checks
    --    bCheatFlying every tick and puts a character back into falling
    --    without it — which is what "jumping higher but still coming down"
    --    looks like from the outside.
    if pcall(function() movement.bCheatFlying = on end) then done[#done + 1] = "bCheatFlying" end

    -- 2. Unreal's own cheat route, which does the setup the other three
    --    cannot: collision, braking, and the physics volume the character is
    --    told it is in. A probe found it on the *pawn* on this build, not on
    --    the controller where Unreal normally puts it — so both are tried,
    --    pawn first, and the log names which one answered.
    if pcall(function() pawn:ClientCheatFly() end) then
        done[#done + 1] = "ClientCheatFly(pawn)"
    elseif pcall(function() controller:ClientCheatFly() end) then
        done[#done + 1] = "ClientCheatFly(controller)"
    end

    -- 3. Stop gravity pulling. Named, so releasing puts back what the game had
    --    rather than a guess at normal.
    if pcall(function()
        movement:SetGravityZMultiplier(FName(GRAVITY_FLAG), on and 0.0 or 1.0)
    end) then done[#done + 1] = "gravity" end

    -- 4. And the mode itself.
    if pcall(function()
        movement:SetMovementMode(on and MOVE_FLYING or MOVE_WALKING, 0)
    end) then done[#done + 1] = "movement mode" end

    if #done == 0 then
        log("this build took none of the flight calls")
        return false
    end

    flying = on
    log(string.format("%s via %s", on and "flying" or "walking", table.concat(done, " + ")))
    return true
end

-- ── holding the sky ─────────────────────────────────────────────────────────
-- Setting the mode is not enough on its own: the game puts a character back
-- into falling on its own tick, and with gravity off but no vertical velocity
-- the result is a drift upward and then a drop — "hit the ceiling and fell",
-- which is exactly what it looks like from inside.
--
-- So flight is held rather than switched: every few frames the flags go back
-- on and the vertical speed is set to what the player last asked for. No
-- input means zero, and zero with no gravity is a hover.
--
-- Space rises, Ctrl descends, and an intent lasts a moment after the key so a
-- tap is a nudge and holding it is a climb.
local RISE_SPEED, INTENT_MS = 900, 500
local intent, intent_at = 0, 0

local function now_ms()
    return math.floor(os.clock() * 1000)
end

local function ask(direction)
    if not flying then return end
    intent, intent_at = direction, now_ms()
end

local function hold_flight()
    if not flying then return end
    local pawn = local_pawn()
    if not pawn then return end
    local movement = pawn.CharacterMovement
    if not movement or not movement:IsValid() then return end

    -- The three that the game keeps undoing.
    pcall(function() movement.bCheatFlying = true end)
    pcall(function() movement:SetGravityZMultiplier(FName(GRAVITY_FLAG), 0.0) end)
    local mode = nil
    pcall(function() mode = movement.MovementMode end)
    if mode ~= nil and mode ~= MOVE_FLYING then
        pcall(function() movement:SetMovementMode(MOVE_FLYING, 0) end)
    end

    -- And the vertical speed, which is what turns "not falling" into flying.
    local wanted = 0
    if intent ~= 0 and (now_ms() - intent_at) < INTENT_MS then wanted = intent * RISE_SPEED end
    pcall(function()
        local v = movement.Velocity
        movement.Velocity = { X = v.X, Y = v.Y, Z = wanted }
    end)
end

-- ── instructions ────────────────────────────────────────────────────────────

local ACTIONS = {
    fly = function(value) return set_flying(value == "on") end,
}

local function obey(what, value)
    local action = ACTIONS[what]
    if not action then
        log("ignored an instruction this version does not know: " .. tostring(what))
        return false
    end
    return action(value) == true
end

-- ── the chat door ───────────────────────────────────────────────────────────
-- The same hook the server uses, on the other side of the wire — and the same
-- way of reading it. A chat payload is not one shape across builds: the text
-- may be the parameter itself or a field on it, and only one of those is true
-- on any given day. The server learned that the hard way; this borrows the
-- answer rather than guessing again.

local MESSAGE_FIELDS = { "Message", "message", "Text", "ChatMessage" }

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

local function to_text(value)
    if value == nil then return nil end
    if type(value) == "string" then return value end
    local ok, text = pcall(function() return value:ToString() end)
    if ok and type(text) == "string" and text ~= "" then return text end
    return nil
end

local function chat_text(payload)
    local direct = to_text(payload)
    if direct then return direct end
    for _, field in ipairs(MESSAGE_FIELDS) do
        local text = to_text(member(payload, field))
        if text then return text end
    end
    return nil
end

-- Every line is logged until an instruction has been understood at least once.
-- Silence is the worst possible symptom: it cannot be told apart from a mod
-- that never loaded, and that is exactly the hole this spent an evening in.
local heard_one = false

local function handle_chat(payload)
    local text = to_text(member(payload, "Message")) or chat_text(payload)
    if not text then
        if not heard_one then
            log(string.format("chat arrived but no text found (payload type: %s)", type(payload)))
        end
        return
    end

    local what, value = text:match(TOKEN)
    if not what then
        if not heard_one then log("saw chat, no instruction in it: " .. text:sub(1, 60)) end
        return
    end

    heard_one = true
    log(string.format("instruction: %s = %s", what, value))
    obey(what, value)
    -- The instruction is NOT blanked. Writing to the message inside a live
    -- multicast crashed the game outright — the payload belongs to the engine
    -- mid-delivery, and editing it there is not ours to do. The cost is that
    -- the player sees the raw line in chat; the alternative was a crash.
end

-- Hooked where the message lands, and on the controller too in case a build
-- routes it differently. Registering a hook that never fires costs nothing;
-- missing the one that does costs an evening.
local TARGETS = {
    "/Script/Pal.PalGameStateInGame:BroadcastChatMessage",
    "/Script/Pal.PalPlayerController:EnterChat_Receive",
}

for _, target in ipairs(TARGETS) do
    local ok = pcall(function()
        RegisterHook(target, function(_context, first, second)
            -- Anything thrown inside an engine hook takes the game with it, so
            -- nothing in here is allowed to escape.
            pcall(handle_chat, unwrap(first))
            if not heard_one then pcall(handle_chat, unwrap(second)) end
        end)
    end)
    log((ok and "listening on " or "could not hook ") .. target)
end

-- Space up, Ctrl down. Registered once; they do nothing at all unless flight
-- is on, so they never get in the way of ordinary play.
pcall(function()
    RegisterKeyBind(Key.SPACE_BAR, function() ask(1) end)
    RegisterKeyBind(Key.LEFT_CONTROL, function() ask(-1) end)
    log("space rises, ctrl descends — while flying")
end)

-- Fast enough to win against the game's own tick: a second was never going to
-- hold a character in the air.
LoopAsync(50, function()
    pcall(hold_flight)
    return false
end)

log("loaded — waiting for instructions from the server")
