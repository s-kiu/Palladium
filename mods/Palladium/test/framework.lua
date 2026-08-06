-- Framework tests: discovery, loading, dispatch, commands, the snapshot.
--
-- The framework touches no engine object, so this runs it directly against a
-- temporary mods tree and a stub host. What it proves is the contract a mod
-- author depends on: a good mod loads and receives events, a bad one is
-- reported instead of taking anything down with it.
--
-- Run: mods/Palladium/test/run-tests.sh

local ROOT = assert(os.getenv("PALLADIUM_TEST_ROOT"), "PALLADIUM_TEST_ROOT is not set")
local SCRIPTS = assert(os.getenv("PALLADIUM_SCRIPTS"), "PALLADIUM_SCRIPTS is not set")
package.path = SCRIPTS .. "/?.lua;" .. package.path

local framework = require("framework")
local Store = require("store")
local Collections = require("collections")
local Permissions = require("permissions")

local function say(text) io.write(text, "\n") end

local failures = 0
local function check(name, condition, detail)
    if condition then
        say("  ok   " .. name)
    else
        failures = failures + 1
        say("  FAIL " .. name .. "\n       " .. tostring(detail))
    end
end

-- ── a mods tree on disk ─────────────────────────────────────────────────────
local MODS = ROOT .. "/Mods"

local function write(path, body)
    local file = assert(io.open(path, "w"))
    file:write(body)
    file:close()
end

local function mkmod(name, body)
    os.execute("mkdir -p '" .. MODS .. "/" .. name .. "'")
    write(MODS .. "/" .. name .. "/mod.lua", body)
end

os.execute("mkdir -p '" .. MODS .. "/Palladium' '" .. ROOT .. "/.state'")

mkmod("Good", [[
local seen = {}
return {
    name = "Good",
    version = "2.0.0",
    description = "a mod that works",
    permissions = { { node = "good.thing", description = "do the thing", default = "allow" } },
    settings = { greeting = "hello" },
    on = {
        ["player.join"] = function(event, pal)
            seen[#seen + 1] = event.subject.name
            pal.message(event.subject.id, pal.settings.greeting)
        end,
    },
    commands = {
        ["!hi"] = { run = function(event, args, pal) pal.message(event.subject.id, "hi " .. args) end },
        ["!locked"] = { node = "good.nope", run = function(_, _, pal) pal.log("should not run") end },
    },
}
]])

mkmod("Dreamer", [[
return { name = "Dreamer", on = {
    ["player.leave"] = function() end,
    ["player.teleported"] = function() end,
} }
]])
mkmod("Keeper", [[
return {
    name = "Keeper",
    data = {
        homes = { description = "saved homes", fields = { x = "number", y = "number" } },
    },
    on = { ["player.join"] = function(event, pal)
        pal.data("homes"):set(event.subject.id, { x = "1", y = "2" })
    end },
}
]])
mkmod("Greedy", [[
return { name = "Greedy", data = { ["Not Valid"] = { fields = {} } } }
]])
mkmod("Ancient", [[
return { name = "Ancient", api = 0, on = { ["player.join"] = function() end } }
]])
mkmod("Futuristic", [[
return { name = "Futuristic", api = 99 }
]])
mkmod("Empty", "return nil")
mkmod("Foreign", [[
return { name = "Foreign", permissions = { { node = "somebodyelse.thing" } } }
]])
mkmod("Broken", "this is not lua {{{")
mkmod("Escapee", [[
LEAKED_GLOBAL = "escaped"
return { name = "Escapee" }
]])

write(MODS .. "/Palladium/mods.list",
    "; a list file wins over any probing\nGood\nDreamer\nKeeper\nGreedy\nAncient\nFuturistic\nEmpty\nForeign\nBroken\nEscapee\n")

-- ── stub host ───────────────────────────────────────────────────────────────
local logged = {}
local calls = {}
Collections.init({ root = ROOT, info = function() end })
-- Palladium keeps its own files beside itself, exactly as it does live; without
-- this the fallback puts them somewhere else and a "restart" reads an empty one.
Collections.home("bridge", MODS .. "/Palladium")

framework.init({
    capabilities = { ["player.give_item"] = true, ["pal.spawn"] = true },
    collections = Collections,
    tags = Collections.declare("bridge", "tags", { fields = { value = "string" } }),
    info = function(text) logged[#logged + 1] = text end,
    call = function(action_type, userid, params, report)
        calls[#calls + 1] = { type = action_type, userid = userid, params = params }
        report(true, nil, {})
    end,
    root = ROOT,
    mods_dir = MODS,
    json_string = function(value, limit)
        local text = tostring(value):gsub('[%c"\\]', "?")
        return '"' .. text:sub(1, limit or 64) .. '"'
    end,
    agent = "Palladium",
    event_types = { ["player.join"] = true, ["player.chat"] = true, ["player.death"] = true,
                    ["player.respawn"] = true, ["player.leave"] = true },
    store = store,
    permissions = Permissions.new(Collections),
})

say("palladium framework")

-- ── loading ─────────────────────────────────────────────────────────────────
local loaded = framework.load()

check("every folder with a mod.lua is accounted for", loaded == 10, loaded)

-- A mod written for a different framework is refused with the reason, not
-- loaded into a shape it does not understand.
check("a mod written for an older API is refused",
    framework.mods.Ancient.ok == false
        and framework.mods.Ancient.error:find("mod API 0", 1, true) ~= nil,
    framework.mods.Ancient.error)
check("and one from the future too",
    framework.mods.Futuristic.ok == false
        and framework.mods.Futuristic.error:find("this Palladium speaks 1", 1, true) ~= nil,
    framework.mods.Futuristic.error)
check("a mod that declares nothing is taken as current",
    framework.mods.Good.ok == true, framework.mods.Good.error)

-- A mod declaring its own storage is the whole point of collections.
check("a mod's declared collection exists as soon as it loads",
    Collections.open("keeper.homes") ~= nil)
check("with the owner taken from the mod, not from the mod's word for it",
    Collections.spec("keeper.homes").owner == "keeper")
check("a collection with an unusable name stops the mod loading",
    framework.mods.Greedy.ok == false
        and framework.mods.Greedy.error:find("collection name", 1, true) ~= nil,
    framework.mods.Greedy.error)
check("a good mod loads", framework.mods.Good and framework.mods.Good.ok == true,
    framework.mods.Good and framework.mods.Good.error)
check("a mod that returns nothing is reported, not loaded",
    framework.mods.Empty and framework.mods.Empty.ok == false
        and framework.mods.Empty.error:find("did not return a table", 1, true) ~= nil,
    framework.mods.Empty and framework.mods.Empty.error)
check("a mod claiming another's permission namespace is refused",
    framework.mods.Foreign and framework.mods.Foreign.error
        and framework.mods.Foreign.error:find('must start with "foreign."', 1, true) ~= nil,
    framework.mods.Foreign and framework.mods.Foreign.error)
check("a mod that will not parse is reported with its syntax error",
    framework.mods.Broken and framework.mods.Broken.ok == false and framework.mods.Broken.error ~= nil,
    framework.mods.Broken and framework.mods.Broken.error)
check("one bad mod does not stop the others loading",
    framework.mods.Good.ok == true and framework.mods.Broken.ok == false)
check("a mod cannot write Palladium's globals",
    LEAKED_GLOBAL == nil and framework.mods.Escapee.ok == true, tostring(LEAKED_GLOBAL))

-- A handler for an event nothing publishes would just never run. Saying so is
-- the difference between a typo and an afternoon.
local dreamer = framework.mods.Dreamer
check("a mod handling an event that does not exist still loads", dreamer.ok == true, dreamer.error)
check("but the dead handler is called out",
    #dreamer.warnings == 1 and dreamer.warnings[1]:find("player.teleported", 1, true) ~= nil,
    table.concat(dreamer.warnings or {}, " | "))
check("and a handler for an event that does exist is not",
    dreamer.warnings[1]:find("player.leave", 1, true) == nil, dreamer.warnings[1])

-- ── dispatch ────────────────────────────────────────────────────────────────
framework.enqueue("player.join", { kind = "player", id = "ID1", name = "Ashen" }, { firstThisRun = true })
check("publishing does not deliver — the queue does", #calls == 0, #calls)

local delivered = framework.drain()
check("draining delivers the event", delivered == 1, delivered)
check("the handler ran and called an action through pal",
    #calls == 1 and calls[1].type == "player.message" and calls[1].userid == "ID1", #calls)
check("the mod's settings reached it", calls[1] and calls[1].params.text == "hello",
    calls[1] and calls[1].params.text)

framework.enqueue("player.death", { kind = "player", id = "ID1", name = "Ashen" }, {})
framework.drain()
check("an event nobody handles is harmless", #calls == 1, #calls)

-- A handler writing through pal.data lands in the collection it declared.
framework.enqueue("player.join", { kind = "player", id = "HOMEOWNER", name = "Fen" }, {})
framework.drain()
check("a mod writes to its own collection through pal.data",
    Collections.open("keeper.homes"):get("HOMEOWNER").x == "1",
    Collections.open("keeper.homes"):get("HOMEOWNER"))
check("and cannot open one it does not own",
    framework.mods.Keeper.pal.data("groups") == nil)


-- A handler that throws must not stop the next event being delivered.
mkmod("Angry", [[
return { name = "Angry", on = { ["player.join"] = function() error("on purpose") end } }
]])
write(MODS .. "/Palladium/mods.list", "Angry\nGood\n")
framework.load()
framework.enqueue("player.join", { kind = "player", id = "ID2", name = "Bo" }, {})
framework.drain()
check("a handler that throws is logged, and the next mod still runs",
    calls[#calls] and calls[#calls].userid == "ID2", calls[#calls] and calls[#calls].userid)
local complained = false
for _, line in ipairs(logged) do
    if line:find("Angry", 1, true) and line:find("on purpose", 1, true) then complained = true end
end
check("and the failure names the mod and the reason", complained, table.concat(logged, " | "))

-- ── chat commands ───────────────────────────────────────────────────────────
local before = #calls
framework.enqueue("player.chat", { kind = "player", id = "ID3", name = "Cy" }, { message = "!hi there" })
framework.drain()
check("a command declared by a mod runs",
    #calls == before + 1 and calls[#calls].params.text == "hi there", calls[#calls] and calls[#calls].params.text)

before = #calls
framework.enqueue("player.chat", { kind = "player", id = "ID3", name = "Cy" }, { message = "!hi again" })
framework.drain()
check("a second command inside the cooldown is dropped", #calls == before, #calls - before)

before = #calls
framework.enqueue("player.chat", { kind = "player", id = "ID4", name = "Di" }, { message = "!nosuchthing" })
framework.drain()
check("an unknown command is left alone", #calls == before, #calls - before)

before = #calls
framework.enqueue("player.chat", { kind = "player", id = "ID5", name = "Ed" }, { message = "!locked" })
framework.drain()
check("a command whose node is not allowed is refused, not run",
    #calls == before + 1 and calls[#calls].params.text:find("not allowed", 1, true) ~= nil,
    calls[#calls] and calls[#calls].params.text)

-- ── the snapshot ────────────────────────────────────────────────────────────
write(MODS .. "/Palladium/mods.list", "Good\nForeign\n")
framework.load()
check("the snapshot is written", framework.snapshot() == true)

local file = assert(io.open(ROOT .. "/.state/palladium-mods.json", "r"))
local body = file:read("a")
file:close()

check("it names the mods that loaded", body:find('"name":"Good"', 1, true) ~= nil, body)
check("it carries the permission nodes they own",
    body:find('"node":"good.thing"', 1, true) ~= nil and body:find('"default":"allow"', 1, true) ~= nil, body)
check("it lists the events they handle", body:find('"player.join"', 1, true) ~= nil, body)
check("it lists their commands", body:find('"!hi"', 1, true) ~= nil, body)
check("a mod that failed is in it with its reason, not missing",
    body:find('"name":"Foreign"', 1, true) ~= nil and body:find('"ok":false', 1, true) ~= nil, body)
check("the snapshot lists collections, so a reader learns what is stored",
    body:find('"name":"bridge.tags"', 1, true) ~= nil, body)
check("with the shape needed to render one it has never heard of",
    body:find('"storage":"data"', 1, true) and body:find('"fields":{', 1, true), body)

-- ── the mod that ships here, driven for real ────────────────────────────────
-- Everything above uses fixtures. This one loads mods/GoldStreak/mod.lua as
-- written and counts to a payout, so the example cannot rot while the tests
-- stay green.

os.execute("mkdir -p '" .. MODS .. "/GoldStreak'")
os.execute("cp '" .. SCRIPTS .. "/../../GoldStreak/mod.lua' '" .. MODS .. "/GoldStreak/mod.lua'")
write(MODS .. "/Palladium/mods.list", "GoldStreak\n")
framework.load()
check("GoldStreak loads as written", framework.mods.GoldStreak and framework.mods.GoldStreak.ok == true,
    framework.mods.GoldStreak and framework.mods.GoldStreak.error)

local player = { kind = "player", id = "PLAYER", name = "Ashen" }
calls = {}
for _ = 1, 4 do
    framework.enqueue("player.respawn", player, {})
    framework.drain()
end
check("nothing is paid out before the fifth respawn", #calls == 0, #calls)

framework.enqueue("player.respawn", player, {})
framework.drain()
local gave, told
for _, call in ipairs(calls) do
    if call.type == "player.give_item" then gave = call end
    if call.type == "player.message" then told = call end
end
check("the fifth respawn pays 50 gold",
    gave and gave.params.item == "Money" and gave.params.count == 50,
    gave and (gave.params.item .. " x" .. tostring(gave.params.count)))
check("and the player is told, after the grant answered",
    told and told.params.text:find("Respawn 5", 1, true) ~= nil, told and told.params.text)

calls = {}
framework.enqueue("player.chat", player, { message = "!streak" })
framework.drain()
check("!streak reports the count Palladium is holding",
    calls[1] and calls[1].params.text:find("Respawns: 5", 1, true) ~= nil,
    calls[1] and calls[1].params.text)

-- The whole reason the store exists: a restart must not reset anyone. Every
-- collection is dropped and rebuilt from disk, the way a real boot does it.
Collections.reset()
Collections.init({ root = ROOT, info = function() end })
Collections.home("bridge", MODS .. "/Palladium")
framework.init({
    tags = Collections.declare("bridge", "tags", { fields = { value = "string" } }),
    permissions = Permissions.new(Collections),
})
framework.load()
calls = {}
for _ = 1, 5 do
    framework.enqueue("player.respawn", player, {})
    framework.drain()
end
local paid = 0
for _, call in ipairs(calls) do
    if call.type == "player.give_item" then paid = paid + 1 end
end
check("a restart does not reset the streak — the tenth respawn pays, not the fifteenth",
    paid == 1, paid)
-- Asserted at the source rather than through !streak again: the command
-- cooldown would swallow a second one this soon, which is itself correct.
local carried = Collections.open("bridge.tags"):get("PLAYER\30goldstreak.respawns")
check("and the count carried across, in the tags collection, namespaced to its mod",
    carried and carried.value == "10", carried)

-- ── every capability as a command ───────────────────────────────────────────
-- Admin surface by default: the node behind each one is registered deny, so a
-- player who has not been granted it is told no.
write(MODS .. "/Palladium/mods.list", "Good\n")
framework.load()
local perms = Permissions.new(Collections)
framework.init({ permissions = perms })
perms:register("bridge", { { node = "player.give_item", default = "deny" } })

local ordinary = { kind = "player", id = "ORDINARY", name = "Nix" }
calls = {}
framework.enqueue("player.chat", ordinary, { message = "!player.give_item item=PalSphere count=5" })
framework.drain()
check("a capability command is refused when the node is not granted",
    calls[1] and calls[1].params.text:find("may not use", 1, true) ~= nil,
    calls[1] and calls[1].params.text)

-- A separate player, because the refusal above counted against the cooldown —
-- which is itself correct.
perms:grant("GRANTED", "player.give_item", "allow")
calls = {}
framework.enqueue("player.chat", { kind = "player", id = "STILLNOT", name = "Nix" },
    { message = "!player.give_item item=PalSphere count=5" })
framework.drain()
check("and someone without the grant still cannot",
    calls[1] and calls[1].params.text:find("may not use", 1, true) ~= nil,
    calls[1] and calls[1].params.text)

calls = {}
framework.enqueue("player.chat", { kind = "player", id = "GRANTED", name = "Ora" },
    { message = "!player.give_item item=PalSphere count=5" })
framework.drain()
local ran = nil
for _, call in ipairs(calls) do
    if call.type == "player.give_item" then ran = call end
end
check("a granted capability runs, with key=value parameters",
    ran and ran.params.item == "PalSphere" and ran.params.count == "5", ran and ran.params)
check("and targets the caller unless told otherwise", ran and ran.userid == "GRANTED", ran and ran.userid)

calls = {}
framework.enqueue("player.chat", { kind = "player", id = "OTHERONE", name = "Nix" },
    { message = "!nosuch.capability x=1" })
framework.drain()
check("a word that is not a capability is left alone", #calls == 0, #calls)

-- ── WelcomeKit, driven for real ─────────────────────────────────────────────
-- The other mod that ships: one kit ever, and only once the items arrived.

os.execute("mkdir -p '" .. MODS .. "/WelcomeKit'")
os.execute("cp '" .. SCRIPTS .. "/../../WelcomeKit/mod.lua' '" .. MODS .. "/WelcomeKit/mod.lua'")
write(MODS .. "/Palladium/mods.list", "WelcomeKit\n")

-- An inventory the stub actually tracks, so the read-back means something.
local carried = {}
framework.init({
    call = function(action_type, userid, params, report)
        calls[#calls + 1] = { type = action_type, userid = userid, params = params }
        if action_type == "player.count_item" then
            return report(true, nil, { { "count", carried[userid .. params.item] or 0 } })
        end
        if action_type == "player.give_item" then
            local key = userid .. params.item
            -- PalSphere lands; Pan is the unknown id that silently adds nothing.
            if params.item ~= "Pan" then
                carried[key] = (carried[key] or 0) + tonumber(params.count)
            end
        end
        report(true, nil, {})
    end,
})
framework.load()

local newcomer = { kind = "player", id = "NEW", name = "Wren" }
calls = {}
framework.enqueue("player.join", newcomer, { firstEver = true })
framework.drain()

local welcomed, announced = nil, false
for _, call in ipairs(calls) do
    if call.type == "player.message" then welcomed = welcomed or call.params.text end
    if call.type == "server.announce" then announced = true end
end
check("a first-ever join is welcomed", welcomed and welcomed:find("Welcome to the server", 1, true) ~= nil, welcomed)
check("and announced to everyone", announced)
-- The claim is a tag, not a call, so it is read where it is actually written.
local tags_c = Collections.open("bridge.tags")
check("a kit that only half arrived is not marked claimed",
    tags_c:get("NEW\30welcomekit.claimed") == nil, tags_c:get("NEW\30welcomekit.claimed"))

local told = nil
for _, call in ipairs(calls) do
    if call.type == "player.message" then told = call.params.text end
end
check("and the player is told rather than left thinking they got it",
    told and told:find("could not be handed over", 1, true) ~= nil, told)

-- Now let everything land, and the claim is written.
carried = {}
framework.init({
    call = function(action_type, userid, params, report)
        calls[#calls + 1] = { type = action_type, userid = userid, params = params }
        if action_type == "player.count_item" then
            return report(true, nil, { { "count", carried[userid .. params.item] or 0 } })
        end
        if action_type == "player.give_item" then
            local key = userid .. params.item
            carried[key] = (carried[key] or 0) + tonumber(params.count)
        end
        report(true, nil, {})
    end,
})
local second = { kind = "player", id = "NEW2", name = "Wren" }
calls = {}
framework.enqueue("player.join", second, { firstEver = true })
framework.drain()
local claim = Collections.open("bridge.tags"):get("NEW2\30welcomekit.claimed")
check("a kit that fully arrived is marked claimed", claim ~= nil and claim.value ~= nil, claim)

-- A returning player is greeted, not re-kitted.
calls = {}
framework.enqueue("player.join", second, { firstEver = false, joins = 4 })
framework.drain()
local gave = 0
for _, call in ipairs(calls) do
    if call.type == "player.give_item" then gave = gave + 1 end
end
check("a returning player gets a greeting and no kit", gave == 0, gave)

say(failures == 0 and "all checks passed" or (failures .. " check(s) failed"))
os.exit(failures == 0 and 0 or 1)
