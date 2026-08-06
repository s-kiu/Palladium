-- Action-level tests for the agent, with the engine stubbed out.
--
-- The mod is loaded exactly as UE4SS loads it — same file, same globals, same
-- boot path — against mock engine objects that answer IsValid/GetClass/
-- ForEachFunction and a handful of Pal functions. Requests go in through the
-- action file the daemon writes, results are read back out of the event file,
-- so what is asserted here is the envelope a caller actually receives.
--
-- What this can prove: parameter validation, dispatch, the deferred answers,
-- and that a handler reports failure when the engine call it made changed
-- nothing. What it cannot: whether the real engine declares these functions.
--
-- Run: mods/Palladium/test/run-tests.sh

local ROOT = assert(os.getenv("PALLADIUM_TEST_ROOT"), "PALLADIUM_TEST_ROOT is not set")
local SCRIPTS = assert(os.getenv("PALLADIUM_SCRIPTS"), "PALLADIUM_SCRIPTS is not set")
package.path = SCRIPTS .. "/?.lua;" .. package.path

-- ── mock engine ─────────────────────────────────────────────────────────────
local delayed = {}
local poll_fn
local logbook = {}
local spent = { ["最大HP"] = 3 } -- points already spent, by the game's own name
local world = {} -- late-bound objects: closures below close over the table

local live = {
    hp = 40, maxHp = 500, maxStomach = 100,
    shield = 0, maxShield = 50, position = { X = 0, Y = 0, Z = 0 },
}

-- Stomach lives where the game keeps it, on the save parameter, so a write
-- through the field is observable through the getter.
local player_save = { FullStomach = 20 }

-- A class the reflection walk can read: the functions it declares are the only
-- ones a handler is allowed to call.
local function mock_class(name, functions, super, properties)
    local function each(list)
        return function(_, callback)
            for _, entry in ipairs(list or {}) do
                callback({ GetFName = function() return { ToString = function() return entry end } end })
            end
        end
    end
    return {
        IsValid = function() return true end,
        GetFullName = function() return "Class /Script/Pal." .. name end,
        ForEachFunction = each(functions),
        ForEachProperty = each(properties),
        GetSuperStruct = function() return super end,
    }
end

local function mock(class, fields)
    local object = fields or {}
    object.IsValid = function() return true end
    object.GetClass = function() return class end
    return object
end

local PARAM_CLASS = mock_class("PalCharacterParameterComponent",
    { "GetHP", "GetMaxHP", "SetMaxHP", "GetFullStomach", "GetMaxFullStomach", "SetFullStomach",
      "GetShieldValue", "GetShieldMaxHP", "SetShieldMaxHP", "SetHateTarget" })
-- The same component on a build that declares no stomach setter at all.
local LEAN_PARAM_CLASS = mock_class("PalCharacterParameterComponentLean",
    { "GetHP", "GetMaxHP", "GetFullStomach", "GetMaxFullStomach",
      "GetShieldValue", "GetShieldMaxHP" })
local CHARACTER_CLASS = mock_class("PalPlayerCharacter", { "K2_GetActorLocation", "K2_TeleportTo" })
local PAL_CLASS = mock_class("PalCharacter", { "K2_GetActorLocation", "K2_TeleportTo" })
local UTILITY_CLASS = mock_class("PalUtility",
    { "SendSystemToPlayerChat", "GetNPCManager", "TeleportAroundLoccation", "SetHPByRateToCharacter" })
local MANAGER_CLASS = mock_class("PalNPCManager", { "SpawnNPCForServer" })
local STATICS_CLASS = mock_class("GameplayStatics", { "ApplyDamage" })

local player_parameter = mock(PARAM_CLASS, {
    IndividualId = { InstanceId = { A = 9, B = 9, C = 9, D = 9 } },
    SaveParameter = player_save,
    SaveParameterMirror = {},
    OnRep_SaveParameter = function() end,
})

local component = mock(PARAM_CLASS, {
    IndividualParameter = player_parameter,
    GetHP = function() return { Value = live.hp } end,
    GetMaxHP = function() return { Value = live.maxHp } end,
    SetMaxHP = function(_, value) live.maxHp = value.Value or value end,
    GetFullStomach = function() return player_save.FullStomach end,
    GetMaxFullStomach = function() return live.maxStomach end,
    GetShieldValue = function() return live.shield end,
    GetShieldMaxHP = function() return live.maxShield end,
    SetFullStomach = function(_, value) player_save.FullStomach = value end,
    -- takes a plain number and rejects the fixed-point struct, the way half of
    -- these setters do
    SetShieldMaxHP = function(_, value)
        assert(type(value) == "number", "SetShieldMaxHP wants a number")
        live.maxShield = value
    end,
})

local pawn = mock(CHARACTER_CLASS, {
    tag = "player-pawn",
    CharacterParameterComponent = component,
    K2_GetActorLocation = function() return live.position end,
    K2_TeleportTo = function(_, at)
        live.position = { X = at.X, Y = at.Y, Z = at.Z }
        return true
    end,
})

local utility = mock(UTILITY_CLASS, {
    SendSystemToPlayerChat = function() end,
    GetNPCManager = function() return world.manager end,
    -- The game's placement call, which here only knows how to move a player:
    -- a pal passed to it comes back where it was, the way an engine call that
    -- is accepted but does nothing behaves.
    TeleportAroundLoccation = function(_, actor, at)
        logbook[#logbook + 1] = "TeleportAroundLoccation"
        if actor == pawn then live.position = { X = at.X, Y = at.Y, Z = at.Z } end
    end,
    SetHPByRateToCharacter = function(_, _, rate)
        live.hp = live.maxHp * rate
        logbook[#logbook + 1] = string.format("SetHPByRateToCharacter %.3f", rate)
    end,
})

local CONTROLLER_CLASS = mock_class("BP_PalPlayerController_C", { "AddPlayerStatusPoint_ToServer" })
local controller = mock(CONTROLLER_CLASS, {
    Pawn = pawn,
    -- takes the name and a count, and max HP is what moves when HP is the stat
    AddPlayerStatusPoint_ToServer = function(_, name, count)
        local key = tostring(name)
        spent[key] = (spent[key] or 0) + count
        if key == "最大HP" then live.maxHp = live.maxHp + 100 * count end
    end,
})

-- The player's record, with the status-point allocation the game computes
-- max HP and the rest from.
local STATE_CLASS = mock_class("PalPlayerState", {}, nil, { "PlayerUId", "StatusPointList" })
local player_state = mock(STATE_CLASS, {
    PlayerUId = { A = 1, B = 2, C = 3, D = 4 },
    PlayerNamePrivate = { ToString = function() return "Tester" end },
    GetPlayerController = function() return controller end,
})
local USERID = "00000001000000020000000300000004"
-- A player character carries its state; that is what tells a player apart from
-- a pal, both here and in the mod.
pawn.PlayerState = player_state

local function new_pal(tag, guid, at)
    local parameter = mock(PARAM_CLASS, {
        IndividualId = { InstanceId = guid },
        SaveParameter = {
            CharacterID = { ToString = function() return "Lamball" end },
            Level = 12, IsRarePal = false, IsPlayer = false,
        },
        SaveParameterMirror = {},
        OnRep_SaveParameter = function() end,
    })
    local parameters = mock(PARAM_CLASS, {
        IndividualParameter = parameter,
        GetIndividualParameter = function() return parameter end,
        SetHateTarget = function(_, target)
            logbook[#logbook + 1] = tag .. " SetHateTarget " .. tostring(target and target.tag)
        end,
    })
    local position = { X = at.X, Y = at.Y, Z = at.Z }
    return {
        parameter = parameter,
        position = function() return position end,
        character = mock(PAL_CLASS, {
            tag = tag,
            CharacterParameterComponent = parameters,
            K2_GetActorLocation = function() return position end,
            K2_TeleportTo = function(_, to)
                position = { X = to.X, Y = to.Y, Z = to.Z }
                return true
            end,
        }),
    }
end

local wild = new_pal("wild", { A = 0xAA, B = 0xBB, C = 0xCC, D = 0xDD }, { X = 0, Y = 0, Z = 0 })
local WILD_ID = "000000AA000000BB000000CC000000DD"
local spawned = new_pal("spawned", { A = 1, B = 1, C = 1, D = 1 }, { X = 300, Y = 0, Z = 100 })
local SPAWNED_ID = "00000001000000010000000100000001"
local loaded_pals = { wild.character }

-- The spawn handle resolves a moment after the spawn call, as it does in game.
local settle_calls = 0
local handle = mock(PAL_CLASS, {
    TryGetIndividualParameter = function()
        settle_calls = settle_calls + 1
        if settle_calls > 1 then return spawned.parameter end
        return nil
    end,
    TryGetIndividualActor = function() return spawned.character end,
})

world.manager = mock(MANAGER_CLASS, {
    NPCAIControllerBaseClass = mock(MANAGER_CLASS, {}),
    SpawnNPCForServer = function(_, info)
        logbook[#logbook + 1] = "SpawnNPCForServer " .. tostring(info.CharacterID)
        loaded_pals[#loaded_pals + 1] = spawned.character
        return handle
    end,
})

local say = print
_G.print = function() end
_G.FName = function(value) return value end
_G.StaticFindObject = function(path)
    if path:find("PalUtility", 1, true) then return utility end
    if path:find("GameplayStatics", 1, true) then return mock(STATICS_CLASS, { ApplyDamage = function() end }) end
    return nil
end
_G.FindFirstOf = function() return mock(CHARACTER_CLASS, {}) end
_G.FindAllOf = function(class)
    if class == "PalPlayerState" then return { player_state } end
    if class == "PalCharacter" then return loaded_pals end
    return {}
end
_G.RegisterHook = function() end
_G.ExecuteWithDelay = function(ms, fn) delayed[#delayed + 1] = { ms = ms, fn = fn } end
_G.ExecuteInGameThread = function(fn) fn() end
_G.LoopAsync = function(_, fn) poll_fn = fn end
_G.GetOwnerController = function() return nil end

local host_getenv = os.getenv
os.getenv = function(name)
    if name == "PAL_ROOT" then return ROOT end
    return host_getenv(name)
end

-- ── harness ─────────────────────────────────────────────────────────────────
local EVENTS = ROOT .. "/logs/bridge-events.jsonl"
local ACTIONS = ROOT .. "/.state/bridge-actions.jsonl"

-- Deferred work is what the agent uses to answer after the engine has had a
-- frame; here it simply runs, oldest first, until nothing is left.
local function drain()
    for _ = 1, 40 do
        local queue = delayed
        if #queue == 0 then break end
        delayed = {}
        for _, entry in ipairs(queue) do entry.fn() end
    end
end

dofile(SCRIPTS .. "/main.lua")
delayed = {} -- the boot-time hook registration timer is not under test

local function send(line)
    local file = assert(io.open(ACTIONS, "a"))
    file:write(line .. "\n")
    file:close()
    poll_fn()
    drain()
end

local function last_result()
    local last = ""
    for line in io.lines(EVENTS) do
        if line:find('"kind":"result"', 1, true) then last = line end
    end
    return last
end

local failures = 0
local function check(name, condition, detail)
    if condition then
        say("  ok   " .. name)
    else
        failures = failures + 1
        say("  FAIL " .. name .. "\n       " .. tostring(detail))
    end
end

say("palladium actions")

-- ── parameter validation ────────────────────────────────────────────────────
send("id=t1\taction=pal.force_spawn\tuserid=" .. USERID .. "\tradius=500")
check("an ordinary radius is in range", not last_result():find("out of range"), last_result())

send("id=t2\taction=player.set_stats\tuserid=" .. USERID .. "\thp=99999999999")
check("an out-of-range value names its bounds",
    last_result():find("hp out of range %(0 to 100000000%)") ~= nil, last_result())

-- ── teleport ────────────────────────────────────────────────────────────────
live.position = { X = 0, Y = 0, Z = 0 }
send("id=t3\taction=player.teleport\tuserid=" .. USERID .. "\tx=1000\ty=2000\tz=300")
check("teleport uses the game's placement call",
    logbook[#logbook] == "TeleportAroundLoccation", table.concat(logbook, ","))
check("teleport answers with where the player landed",
    last_result():find('"ok":true') and last_result():find('"x":1000'), last_result())
check("teleport names the call that worked",
    last_result():find("TeleportAroundLoccation") ~= nil, last_result())

local placement = utility.TeleportAroundLoccation
local engine_teleport = pawn.K2_TeleportTo
utility.TeleportAroundLoccation = function() end
pawn.K2_TeleportTo = function() end
send("id=t4\taction=player.teleport\tuserid=" .. USERID .. "\tx=90000\ty=90000\tz=0")
check("a teleport that moves nobody fails rather than reporting success",
    last_result():find("teleport_failed") ~= nil, last_result())
utility.TeleportAroundLoccation = placement
pawn.K2_TeleportTo = engine_teleport

-- ── stats ───────────────────────────────────────────────────────────────────
live.hp = 40
send("id=t5\taction=player.set_stats\tuserid=" .. USERID .. "\thp=250")
check("an absolute hp becomes the rate the engine wants", math.abs(live.hp - 250) < 0.01, live.hp)
check("set_stats reports hp as applied", last_result():find('"applied":"hp"') ~= nil, last_result())

local feed = component.SetFullStomach
component.SetFullStomach = function() end
local field = player_save.FullStomach
player_save.FullStomach = nil -- no setter, no field: nothing can carry the write
send("id=t6\taction=player.set_stats\tuserid=" .. USERID .. "\thunger=80")
check("a write the engine accepts but ignores reads as unverified",
    last_result():find('"unverified":"hunger"') ~= nil, last_result())
player_save.FullStomach = field
component.SetFullStomach = feed

-- HP above the ceiling raises the ceiling with it, rather than clamping
live.hp, live.maxHp = 40, 500
send("id=t7\taction=player.set_stats\tuserid=" .. USERID .. "\thp=2000")
check("hp above the maximum raises the maximum", live.maxHp == 2000, live.maxHp)
check("hp then reaches the value asked for", math.abs(live.hp - 2000) < 0.01, live.hp)

-- and when the ceiling cannot move, the answer says the engine capped it
component.GetClass = function() return LEAN_PARAM_CLASS end
live.hp, live.maxHp = 40, 500
send("id=t8\taction=player.set_stats\tuserid=" .. USERID .. "\thp=9000")
check("a capped write says so rather than reading as a clean success",
    last_result():find("the engine capped it") ~= nil, last_result())
component.GetClass = function() return PARAM_CLASS end
live.maxHp = 500

-- ── heal ────────────────────────────────────────────────────────────────────
live.hp, player_save.FullStomach = 10, 5
send("id=t9\taction=player.heal\tuserid=" .. USERID)
check("heal fills hp", math.abs(live.hp - live.maxHp) < 0.01, live.hp)
check("heal feeds the player", player_save.FullStomach == live.maxStomach, player_save.FullStomach)
check("heal reports what it applied",
    last_result():find('"applied":"hp,hunger') ~= nil, last_result())

-- a build with no stomach setter: the save-parameter field carries the write
component.GetClass = function() return LEAN_PARAM_CLASS end
live.hp, player_save.FullStomach = 10, 5
send("id=t10\taction=player.heal\tuserid=" .. USERID)
check("heal feeds the player through the save parameter when no setter exists",
    player_save.FullStomach == live.maxStomach, player_save.FullStomach)
check("heal names the save field it went through",
    last_result():find('"applied":"hp,hunger"') ~= nil, last_result())
component.GetClass = function() return PARAM_CLASS end

-- and when nothing at all can carry it, the failure says what the build has
component.GetClass = function() return LEAN_PARAM_CLASS end
player_save.FullStomach = nil
send("id=t11\taction=player.set_stats\tuserid=" .. USERID .. "\thunger=50")
check("a stat with no way in reports the reason and what is declared",
    last_result():find("declared: GetFullStomach GetMaxFullStomach") ~= nil, last_result())
component.GetClass = function() return PARAM_CLASS end
player_save.FullStomach = 100

-- ── probe ───────────────────────────────────────────────────────────────────
send("id=t12\taction=bridge.probe\tuserid=" .. USERID .. "\ton=params\tfilter=stomach")
check("probe lists the matching declared functions",
    last_result():find('"functions":%["GetFullStomach","GetMaxFullStomach","SetFullStomach"%]') ~= nil,
    last_result())

send("id=t13\taction=bridge.probe\tuserid=\ton=utility\tfilter=teleport")
check("probe runs without a target player",
    last_result():find('"functions":%["TeleportAroundLoccation"%]') ~= nil, last_result())

-- ── hate ────────────────────────────────────────────────────────────────────
send("id=t14\taction=pal.aggro\tuserid=" .. USERID .. "\tpal=deadbeef")
check("aggro on an unknown pal says so", last_result():find("pal_not_found") ~= nil, last_result())

send("id=t15\taction=pal.aggro\tuserid=" .. USERID .. "\tpal=" .. WILD_ID)
check("aggro uses a hate function the build declares",
    last_result():find('"via":"SetHateTarget"') ~= nil, last_result())
check("aggro points the pal at the player's own pawn",
    logbook[#logbook] == "wild SetHateTarget player-pawn", table.concat(logbook, ","))

-- ── spawn ───────────────────────────────────────────────────────────────────
send("id=t16\taction=pal.spawn\tuserid=" .. USERID ..
     "\tspecies=Lamball\tlevel=5\tx=7000\ty=8000\tz=900\thostile=true")
check("spawn answers with the new pal's id",
    last_result():find('"pal":"' .. SPAWNED_ID .. '"') ~= nil, last_result())
check("spawn ends up at the coordinates asked for",
    math.abs(spawned.position().X - 7000) < 1 and math.abs(spawned.position().Y - 8000) < 1,
    string.format("%.0f,%.0f", spawned.position().X, spawned.position().Y))
check("spawn reports where it landed", last_result():find('"x":7000') ~= nil, last_result())
check("a hostile spawn seeds hate against the target",
    last_result():find('"aggro":"SetHateTarget"') ~= nil, last_result())

send("id=t17\taction=pal.spawn\tuserid=\tspecies=Lamball\tx=100\ty=200\tz=300")
check("spawn works with coordinates and no target player",
    last_result():find('"ok":true') ~= nil, last_result())

-- a setter that only accepts a plain number still gets found
send("id=t18\taction=player.set_stats\tuserid=" .. USERID .. "\tmaxShield=250")
check("a setter is offered the struct and the plain number", live.maxShield == 250, live.maxShield)

-- and max HP, which this game computes rather than stores, says what to do instead
component.GetClass = function() return LEAN_PARAM_CLASS end
send("id=t19\taction=player.set_stats\tuserid=" .. USERID .. "\tmaxHp=9000")
check("an uncomputable max HP explains the way round it",
    last_result():find("raise talentHp/level/rank") ~= nil, last_result())
component.GetClass = function() return PARAM_CLASS end

-- a player is refused the stats that only mean something on a pal, while the
-- rest of the same call still applies
send("id=t20\taction=player.set_stats\tuserid=" .. USERID .. "\thunger=60\ttalentHp=100")
check("IVs are refused on a player rather than reported as applied",
    last_result():find('"failed":"talentHp"') ~= nil, last_result())
check("the rest of the call still applies",
    last_result():find('"applied":"hunger"') ~= nil, last_result())
check("and the refusal points at the player's equivalent",
    last_result():find("player.status_point is the equivalent") ~= nil, last_result())

-- status points: read what the player has spent, then spend more
send("id=t21\taction=player.status_points\tuserid=" .. USERID)
check("with no reader, the spendable names are still offered",
    last_result():find('"readable":false') and last_result():find("最大HP") ~= nil, last_result())

live.maxHp = 500
send("id=t22\taction=player.status_point\tuserid=" .. USERID .. "\tstat=最大HP\tpoints=7")
check("spending goes through the writer the controller declares",
    last_result():find('"via":"AddPlayerStatusPoint_ToServer"') ~= nil, last_result())
check("the points land", spent["最大HP"] == 10, spent["最大HP"])
check("and the stat it feeds is what proves it", live.maxHp == 1200, live.maxHp)
check("the result names the stat that moved",
    last_result():find('"changed":"maxHp"') ~= nil, last_result())

-- a name this build does not know takes the call but moves nothing
send("id=t23\taction=player.status_point\tuserid=" .. USERID .. "\tstat=NotAStat\tpoints=1")
check("a name that moves nothing says so rather than claiming success",
    last_result():find('"verified":false') ~= nil, last_result())

-- properties are reported alongside functions: a value kept in a field is
-- invisible to a function list, which is how the first status-point probe missed
send("id=t24\taction=bridge.probe\tuserid=" .. USERID .. "\ton=state\tfilter=status")
check("probe reports properties, not only functions",
    last_result():find('"properties":%["StatusPointList"%]') ~= nil, last_result())
check("probe reports the functions in the same answer",
    last_result():find('"functions":') ~= nil, last_result())

say(failures == 0 and "all checks passed" or (failures .. " check(s) failed"))
os.exit(failures == 0 and 0 or 1)
