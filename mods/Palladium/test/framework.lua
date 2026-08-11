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

-- The mods this framework ships with are examples first: they live in
-- examples/lua/, and an operator may also have copied one into mods/ to
-- run it. Look in both, and say so loudly when neither has it — a missing file
-- otherwise reads as a dozen unrelated failures further down.
local REPO = SCRIPTS .. "/../../.."
local function shipped_mod(name)
    for _, path in ipairs({
        REPO .. "/examples/lua/" .. name .. "/mod.lua",
        REPO .. "/mods/" .. name .. "/mod.lua",
    }) do
        local probe = io.open(path, "r")
        if probe then probe:close() return path end
    end
    error(string.format(
        "cannot find the shipped mod %s: looked in examples/lua/%s and mods/%s", name, name, name))
end

-- Those mods call real capabilities, so the fixtures they run against have to
-- be the real ones: this is the table the agent hands the framework in
-- production. Using it here means a shipped mod that learns a new call does
-- not also need a line adding to a fixture before its test can pass.
local REAL_CAPABILITIES = dofile(SCRIPTS .. "/generated/capabilities.lua").actions
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

local function exists_file(path)
    local file = io.open(path, "r")
    if file then file:close() end
    return file ~= nil
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
-- Everything above uses fixtures. This one loads GoldStreak's real mod.lua as
-- written and counts to a payout, so the example cannot rot while the tests
-- stay green.

framework.init({ capabilities = REAL_CAPABILITIES })
os.execute("mkdir -p '" .. MODS .. "/GoldStreak'")
os.execute("cp '" .. shipped_mod("GoldStreak") .. "' '" .. MODS .. "/GoldStreak/mod.lua'")
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

-- ── a mod's own command, under a constrained grant ──────────────────────────
-- The bug this exists for: a mod command's node used to be resolved with no
-- parameters at all, so any `where` on it refused every call forever — the
-- grant was unusable and the refusal did not say why.
mkmod("Handout", [[
return {
    name = "Handout",
    permissions = { { node = "handout.give", description = "hand items over", default = "deny" } },
    commands = {
        ["!handout"] = {
            node = "handout.give",
            target = "player",
            help = "!handout @Name <item> [count]",
            params = {
                { name = "item", kind = "item_id", required = true },
                { name = "count", kind = "int", min = 1, max = 9999, default = 1 },
            },
            run = function(_event, _args, pal, params, target)
                pal.player.give_item(target, { item = params.item, count = params.count })
            end,
        },
    },
}
]])
write(MODS .. "/Palladium/mods.list", "Handout\n")
framework.load()
perms:register("handout", { { node = "handout.give", default = "deny" } })
perms:grant("HANDOUT1", "handout.give", "allow",
    "where item in Money,DogCoin and count <= 1000")
perms:grant("HANDOUT2", "handout.give", "allow",
    "where item in Money,DogCoin and count <= 1000")

local function handout_as(id, line)
    calls = {}
    framework.enqueue("player.chat", { kind = "player", id = id, name = id }, { message = line })
    framework.drain()
    local gave, said
    for _, call in ipairs(calls) do
        if call.type == "player.give_item" then gave = call end
        if call.type == "player.message" then said = call.params.text end
    end
    return gave, said
end

local gave, said = handout_as("HANDOUT1", "!handout DogCoin 100")
check("a constrained grant on a mod command now passes when the call satisfies it",
    gave ~= nil and gave.params.item == "DogCoin", said or "nothing ran")
check("and the parsed parameters reach the command",
    gave and gave.params.count == "100", gave and gave.params)

local blocked, why = handout_as("HANDOUT2", "!handout PalSphere 5")
check("a call outside the constraint is refused", blocked == nil, blocked and blocked.params)
check("and the refusal names the constraint rather than saying nothing",
    why ~= nil and why:find("item must be one of", 1, true) ~= nil, why)

-- ── the two silences ────────────────────────────────────────────────────────
-- Both of these resolve to "no" without a word anywhere, which is what turns
-- a mistyped grant into an unexplainable one.
perms:grant("LINTED", "handout.give", "allow", "where item matches Sphere_* and count <= 50")
local groups_c = perms.groups_c
groups_c:set("linters", { weight = "1", is_default = "false",
    allow = { "handout.give where count <= 5", "handout.give where count <= 500" } })

local linted = perms:lint()
local reported = table.concat(linted, "\n")
check("an unreadable condition is reported, with the fragment quoted",
    reported:find("cannot read `item matches Sphere_%*`") ~= nil, reported)
check("and the readable half of the same rule still applies",
    (perms:resolve("LINTED", "handout.give", { count = 10 })) == true
        and (perms:resolve("LINTED", "handout.give", { count = 500 })) == false,
    reported)
check("a node listed twice in one group is reported as unreachable",
    reported:find("listed more than once", 1, true) ~= nil, reported)

-- ── chat ergonomics: aliases, positions, @me, help ──────────────────────────
-- Declared parameters, as the generated capabilities table carries them.
framework.init({ capabilities = {
    ["player.give_item"] = { target = "player", params = {
        { name = "item", kind = "item_id", required = true },
        { name = "count", kind = "int", min = 1, max = 9999, default = 1 },
    } },
    ["pal.spawn"] = { target = "player", params = {
        { name = "species", kind = "item_id", required = true },
        { name = "level", kind = "int", min = 1, max = 100, default = 10 },
        { name = "rare", kind = "bool", default = false },
        { name = "traits", kind = "string", max_len = 200 },
    } },
    ["player.position"] = { target = "player", params = {} },
} })

perms:grant("ALIASED", "player.give_item", "allow")
calls = {}
framework.enqueue("player.chat", { kind = "player", id = "ALIASED", name = "Al" },
    { message = "!give_item PalSphere 3" })
framework.drain()
local aliased
for _, call in ipairs(calls) do if call.type == "player.give_item" then aliased = call end end
check("the short alias reaches the capability, arguments by position",
    aliased ~= nil and aliased.params.item == "PalSphere" and aliased.params.count == "3",
    aliased and (tostring(aliased.params.item) .. "/" .. tostring(aliased.params.count)))

perms:grant("POSITIONAL", "pal.spawn", "allow")
calls = {}
framework.enqueue("player.chat", { kind = "player", id = "POSITIONAL", name = "Po" },
    { message = "!pal.spawn @me IceDrake 25 [WorldTree_ATK]" })
framework.drain()
local spawned
for _, call in ipairs(calls) do if call.type == "pal.spawn" then spawned = call end end
check("@me targets the caller and positions fill species, level and traits",
    spawned ~= nil and spawned.userid == "POSITIONAL" and spawned.params.species == "IceDrake"
        and spawned.params.level == "25" and spawned.params.traits == "WorldTree_ATK",
    spawned and (tostring(spawned.params.species) .. "/" .. tostring(spawned.params.level)
        .. "/" .. tostring(spawned.params.traits)))

calls = {}
framework.enqueue("player.chat", { kind = "player", id = "CURIOUS", name = "Cu" },
    { message = "?spawn" })
framework.drain()
local usage
for _, call in ipairs(calls) do
    if call.type == "player.message" and call.params.text:find("<species>", 1, true) then usage = call end
end
check("?spawn answers with the declared shape",
    usage ~= nil and usage.userid == "CURIOUS" and usage.params.text:find("%[level%]") ~= nil,
    usage and usage.params.text)

perms:grant("LISTED", "pal.spawn", "allow")
calls = {}
framework.enqueue("player.chat", { kind = "player", id = "LISTED", name = "Li" },
    { message = "!commands" })
framework.drain()
local listing
for _, call in ipairs(calls) do
    if call.type == "player.message" and call.params.text:find("!spawn", 1, true) then listing = call end
end
check("!commands names what the caller may use, by its shortest word",
    listing ~= nil, listing and listing.params.text)
local leaked
for _, call in ipairs(calls) do
    if call.type == "player.message" and call.params.text:find("give_item", 1, true) then leaked = call end
end
check("and not what they may not", leaked == nil, leaked and leaked.params.text)

-- ── self-only grants: target = @me ──────────────────────────────────────────
perms:group_create("members", "MEM", 5)
perms:group_set_entry("members", "player.position", "allow", "where target = @me")
perms:assign("SELFISH", "members")
perms:assign("SNOOPER", "members")

calls = {}
framework.enqueue("player.chat", { kind = "player", id = "SELFISH", name = "Se" },
    { message = "!player.position" })
framework.drain()
local own
for _, call in ipairs(calls) do if call.type == "player.position" then own = call end end
check("a grant narrowed to target = @me serves the caller",
    own ~= nil and own.userid == "SELFISH", own and own.userid)

calls = {}
framework.enqueue("player.chat", { kind = "player", id = "SNOOPER", name = "Sn" },
    { message = "!player.position target=SOMEBODYELSE" })
framework.drain()
local refused, snooped
for _, call in ipairs(calls) do
    if call.type == "player.position" then snooped = call end
    if call.type == "player.message" and call.params.text:find("target", 1, true) then refused = call end
end
check("and refuses the same word aimed at somebody else",
    snooped == nil and refused ~= nil, refused and refused.params.text)

-- ── rank constraints: target_group and target_weight ────────────────────────
-- Moderators may act downward, never sideways or up — and always on
-- themselves, because self weighs -1.
framework.init({ capabilities = {
    ["player.teleport"] = { target = "player", params = {
        { name = "x", kind = "number", required = true },
        { name = "y", kind = "number", required = true },
        { name = "z", kind = "number", required = true },
    } },
} })
perms:group_create("mods", "MOD", 12)
perms:group_create("bosses", "BOSS", 15)
perms:group_set_entry("mods", "player.teleport", "allow", "where target_weight < 12")
perms:assign("MODONE", "mods")
perms:assign("MODTWO", "mods")
perms:assign("BIGBOSS", "bosses")

calls = {}
framework.enqueue("player.chat", { kind = "player", id = "MODONE", name = "M1" },
    { message = "!player.teleport 1 2 3 target=SNOOPER" })
framework.drain()
local moved
for _, call in ipairs(calls) do if call.type == "player.teleport" then moved = call end end
check("a rank-limited grant reaches a lower-ranked target",
    moved ~= nil and moved.userid == "SNOOPER", moved and moved.userid)

calls = {}
framework.enqueue("player.chat", { kind = "player", id = "MODTWO", name = "M2" },
    { message = "!player.teleport 1 2 3 target=BIGBOSS" })
framework.drain()
local upward, stopped
for _, call in ipairs(calls) do
    if call.type == "player.teleport" then upward = call end
    if call.type == "player.message" and call.params.text:find("target_weight", 1, true) then stopped = call end
end
check("and stops at a higher-ranked one, saying why",
    upward == nil and stopped ~= nil, stopped and stopped.params.text)

calls = {}
framework.enqueue("player.chat", { kind = "player", id = "MODONE", name = "M1" },
    { message = "!player.teleport 1 2 3" })
framework.drain()
-- MODONE's cooldown from the first teleport may still hold in a fast run;
-- self-targeting is proven through the resolver directly instead.
local self_ok = perms:resolve("MODONE", "player.teleport",
    { target = "@me", target_group = "@me", target_weight = -1, x = "1", y = "2", z = "3" })
check("while self-targeting passes every rank constraint", self_ok == true, self_ok)

-- ── the resolver derives standing itself, whatever the surface ──────────────
local surface_ok = perms:resolve("MODONE", "player.teleport", { target = "SNOOPER" })
local _, _, _, surface_no = perms:resolve("MODTWO", "player.teleport", { target = "BIGBOSS" })
check("a bare target is enough — standing is derived in the resolver",
    surface_ok == true and surface_no ~= nil and surface_no:find("target_weight", 1, true) ~= nil,
    tostring(surface_ok) .. "/" .. tostring(surface_no))

perms:group_set_entry("mods", "group.assign", "allow", "where group_weight < 12")
local assign_down = perms:resolve("MODONE", "group.assign", { group = "members" })
local assign_up = perms:resolve("MODONE", "group.assign", { group = "bosses" })
check("group_weight keeps a grant of group.assign below the granter",
    assign_down == true and assign_up == false,
    tostring(assign_down) .. "/" .. tostring(assign_up))

-- ── or-alternatives ─────────────────────────────────────────────────────────
perms:grant("EITHER", "player.teleport", "allow", "where target = @me or target_weight < 5")
local or_self = perms:resolve("EITHER", "player.teleport", { target = "@me" })
local or_down = perms:resolve("EITHER", "player.teleport", { target = "GROUPLESS" })
local or_up = perms:resolve("EITHER", "player.teleport", { target = "BIGBOSS" })
check("an or-constraint passes when either alternative holds",
    or_self == true and or_down == true and or_up == false,
    tostring(or_self) .. "/" .. tostring(or_down) .. "/" .. tostring(or_up))

-- ── time-based grants ───────────────────────────────────────────────────────
perms:grant("FOREVERISH", "player.teleport", "allow", nil, "2099-01-01")
perms:grant("LAPSED", "player.teleport", "allow", nil, "2020-01-01")
local timed_ok = perms:resolve("FOREVERISH", "player.teleport", { target = "@me" })
local timed_no, timed_src = perms:resolve("LAPSED", "player.teleport", { target = "@me" })
check("a dated grant holds before its stamp and is gone after",
    timed_ok == true and timed_no == false and timed_src ~= "user",
    tostring(timed_ok) .. "/" .. tostring(timed_no) .. "/" .. tostring(timed_src))
local bad_ok, bad_err = perms:grant("SOMEONE", "player.teleport", "allow", nil, "not-a-date")
check("and an unreadable stamp is refused at grant time",
    bad_ok == false and bad_err == "invalid_until", tostring(bad_ok) .. "/" .. tostring(bad_err))

-- ── @name targeting ─────────────────────────────────────────────────────────
framework.init({
    player_by_name = function(name) return name:lower() == "cy" and "ID3" or nil end,
    capabilities = {
        ["player.teleport"] = { target = "player", scope = "write", params = {
            { name = "x", kind = "number", required = true },
            { name = "y", kind = "number", required = true },
            { name = "z", kind = "number", required = true },
        } },
    },
})
perms:grant("NAMER", "player.teleport", "allow")
calls = {}
framework.enqueue("player.chat", { kind = "player", id = "NAMER", name = "Na" },
    { message = "!player.teleport 1 2 3 target=@Cy" })
framework.drain()
local named
for _, call in ipairs(calls) do if call.type == "player.teleport" then named = call end end
check("@Name resolves to the online player of that name",
    named ~= nil and named.userid == "ID3", named and named.userid)

perms:grant("GHOSTCALLER", "player.teleport", "allow")
calls = {}
framework.enqueue("player.chat", { kind = "player", id = "GHOSTCALLER", name = "Gh" },
    { message = "!player.teleport 1 2 3 @Ghost" })
framework.drain()
local ghosted
for _, call in ipairs(calls) do
    if call.type == "player.message" and call.params.text:find("no player named Ghost", 1, true) then
        ghosted = call
    end
end
check("and a name nobody online carries is refused, not guessed",
    ghosted ~= nil, ghosted and ghosted.params.text)

perms:grant("WALKER", "player.teleport", "allow")
calls = {}
framework.enqueue("player.chat", { kind = "player", id = "WALKER", name = "Wa" },
    { message = "!player.teleport @Cy" })
framework.drain()
local goto_call
for _, call in ipairs(calls) do if call.type == "player.teleport" then goto_call = call end end
check("a bare player destination reads as take-me-to-them",
    goto_call ~= nil and goto_call.userid == "WALKER" and goto_call.params.to == "ID3",
    goto_call and (tostring(goto_call.userid) .. "/" .. tostring(goto_call.params.to)))

-- ── the audit file ──────────────────────────────────────────────────────────
local audit_file = io.open(ROOT .. "/logs/bridge-audit.log", "r")
local audit_text = audit_file and audit_file:read("a") or ""
if audit_file then audit_file:close() end
check("a chat write landed in the audit file",
    audit_text:find("chat:NAMER\tplayer.teleport\tID3", 1, true) ~= nil,
    audit_text:sub(-200))

-- ── WelcomeKit, driven for real ─────────────────────────────────────────────
-- The other mod that ships: one kit ever, and only once the items arrived.

os.execute("mkdir -p '" .. MODS .. "/WelcomeKit'")
os.execute("cp '" .. shipped_mod("WelcomeKit") .. "' '" .. MODS .. "/WelcomeKit/mod.lua'")
write(MODS .. "/Palladium/mods.list", "WelcomeKit\n")

-- An inventory the stub actually tracks, because the read-back now lives in
-- the capability rather than in the mod: player.give_item is what reports
-- whether the items arrived, so the stub has to answer the way it does.
local carried = {}
framework.init({
    capabilities = REAL_CAPABILITIES,
    call = function(action_type, userid, params, report)
        calls[#calls + 1] = { type = action_type, userid = userid, params = params }
        if action_type == "player.count_item" then
            return report(true, nil, { { "count", carried[userid .. params.item] or 0 } })
        end
        if action_type == "player.give_item" then
            local key = userid .. params.item
            -- PalSphere lands; Pan is the unknown id the engine accepts while
            -- adding nothing, which the real capability catches by counting
            -- before and after and reports as a failure.
            if params.item == "Pan" then
                return report(false,
                    'give_failed: nothing arrived — is "' .. params.item .. '" a real item id?',
                    { { "item", params.item }, { "delivered", "false" } })
            end
            carried[key] = (carried[key] or 0) + tonumber(params.count)
            return report(true, nil,
                { { "item", params.item }, { "count", params.count }, { "delivered", "true" } })
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

-- ── TimedRewards, driven for real ───────────────────────────────────────────
-- Hour marks from settings: every unpaid mark at or below the hours played
-- pays once, and the ladder is the operator's to redefine.

os.execute("mkdir -p '" .. MODS .. "/TimedRewards'")
os.execute("cp '" .. shipped_mod("TimedRewards") .. "' '" .. MODS .. "/TimedRewards/mod.lua'")
write(MODS .. "/Palladium/mods.list", "TimedRewards\n")

local play_minutes = 330 -- five and a half hours: the 1 and 5 marks, not the 10
framework.init({
    event_types = { ["player.join"] = true, ["player.hour"] = true, ["player.chat"] = true },
    call = function(action_type, userid, params, report)
        calls[#calls + 1] = { type = action_type, userid = userid, params = params }
        if action_type == "player.playtime" then
            return report(true, nil,
                { { "minutes", play_minutes }, { "session", 5 }, { "online", true } })
        end
        report(true, nil, {})
    end,
})
framework.load()

local climber = { kind = "player", id = "CLIMB", name = "Cli" }
calls = {}
framework.enqueue("player.hour", climber, { hours = 5, minutes = play_minutes })
framework.drain()
local spheres, gold = 0, 0
for _, call in ipairs(calls) do
    if call.type == "player.give_item" then
        if call.params.item == "PalSphere" then spheres = spheres + tonumber(call.params.count) end
        if call.params.item == "Money" then gold = gold + tonumber(call.params.count) end
    end
end
check("every mark at or below the hours played pays once",
    spheres == 5 and gold == 500, tostring(spheres) .. "/" .. tostring(gold))

calls = {}
framework.enqueue("player.hour", climber, { hours = 5, minutes = play_minutes })
framework.drain()
local repay = 0
for _, call in ipairs(calls) do
    if call.type == "player.give_item" then repay = repay + 1 end
end
check("a mark never pays twice", repay == 0, repay)

write(MODS .. "/TimedRewards/settings.config",
    "rewards.1.hours = 2\nrewards.1.item = Pan\nrewards.1.count = 3\n")
framework.reload_settings()
calls = {}
framework.enqueue("player.hour", climber, { hours = 6, minutes = 370 })
framework.drain()
local bread
for _, call in ipairs(calls) do
    if call.type == "player.give_item" and call.params.item == "Pan" then bread = call end
end
check("a redefined ladder pays its new marks retroactively",
    bread ~= nil and tonumber(bread.params.count) == 3, bread and bread.params.count)

write(MODS .. "/TimedRewards/settings.config", "; nothing overridden\n")
framework.reload_settings()
play_minutes = 610
calls = {}
framework.enqueue("player.hour", climber, { hours = 10, minutes = play_minutes })
framework.drain()
local tenth
for _, call in ipairs(calls) do
    if call.type == "player.give_item" and call.params.item == "Money" then tenth = call end
end
check("an emptied overlay hands the author's ladder back",
    tenth ~= nil and tonumber(tenth.params.count) == 1500, tenth and tenth.params.count)

-- ── a shipped settings example becomes the live file, once ─────────────────
os.execute("mkdir -p '" .. MODS .. "/Seeded'")
write(MODS .. "/Seeded/mod.lua", [[
return { name = "Seeded", settings = { greeting = "default" },
    on = { ["player.join"] = function() end } }
]])
write(MODS .. "/Seeded/settings.example.config", "; shipped example\ngreeting = tuned\n")
write(MODS .. "/Palladium/mods.list", "Seeded\n")
framework.init({
    event_types = { ["player.join"] = true },
    call = function(_, _, _, report) report(true, nil, {}) end,
})
framework.load()
check("a shipped example becomes settings.config on first load",
    exists_file(MODS .. "/Seeded/settings.config"))
check("and the mod reads the seeded values",
    framework.mods.Seeded.pal.settings.greeting == "tuned",
    framework.mods.Seeded.pal.settings.greeting)

write(MODS .. "/Seeded/settings.config", "greeting = operator\n")
write(MODS .. "/Seeded/settings.example.config", "greeting = newexample\n")
framework.load()
check("an existing settings.config is never overwritten by the example",
    framework.mods.Seeded.pal.settings.greeting == "operator",
    framework.mods.Seeded.pal.settings.greeting)

-- ── Leaderboards, driven for real ───────────────────────────────────────────
-- Standings refresh on the clock's cadence, never because somebody asked.

os.execute("mkdir -p '" .. MODS .. "/Leaderboards'")
os.execute("cp '" .. shipped_mod("Leaderboards") .. "' '" .. MODS .. "/Leaderboards/mod.lua'")
write(MODS .. "/Palladium/mods.list", "Leaderboards\n")

-- Each board leads with a different player, so a board reading from the wrong
-- column cannot pass by luck.
-- Held onto so a board can be taken away from one player further down: the
-- framework keeps whatever init was last given, and this is the same object.
local board_perms = Permissions.new(Collections)
local levels = { HIGH = 42, LOW = 7 }
local minutes = { HIGH = 60, LOW = 600 }
local captures = { HIGH = 99, LOW = 3 }
local fished = { HIGH = 4, LOW = 40 }
local crafted = { HIGH = 70, LOW = 7 }
local bosses = { HIGH = 2, LOW = 20 }
framework.init({
    permissions = board_perms,
    event_types = { ["player.join"] = true, ["player.chat"] = true, ["clock.minute"] = true },
    call = function(action_type, userid, params, report)
        calls[#calls + 1] = { type = action_type, userid = userid, params = params }
        if action_type == "player.stats" then
            return report(true, nil, { { "level", levels[userid] or 0 }, { "hp", 1 }, { "maxHp", 1 } })
        end
        if action_type == "player.playtime" then
            return report(true, nil, {
                { "minutes", minutes[userid] or 0 }, { "session", 0 },
                { "online", true }, { "name", userid == "HIGH" and "Hi" or "Lo" },
            })
        end
        if action_type == "player.records" then
            return report(true, nil, {
                { "captures", captures[userid] or 0 }, { "paldex", 1 },
                { "fished", fished[userid] or 0 },
                { "crafted", crafted[userid] or 0 },
                { "bosses", bosses[userid] or 0 },
            })
        end
        report(true, nil, {})
    end,
})
framework.load()

framework.enqueue("player.join", { kind = "player", id = "HIGH", name = "Hi" }, {})
framework.enqueue("player.join", { kind = "player", id = "LOW", name = "Lo" }, {})
framework.drain()

levels.LOW = 90 -- they levelled hard; only a refresh may notice
calls = {}
framework.enqueue("player.chat", { kind = "player", id = "HIGH", name = "Hi" }, { message = "!lb" })
framework.drain()
-- A board arrives as several messages, one per line, so the answer is all of
-- them together rather than whichever one happened to carry the heading.
local function said()
    local lines = {}
    for _, call in ipairs(calls) do
        if call.type == "player.message" then lines[#lines + 1] = call.params.text end
    end
    return table.concat(lines, "\n")
end

local asked_engine
for _, call in ipairs(calls) do
    if call.type == "player.stats" then asked_engine = true end
end
local board = said()
check("!lb answers from the last refresh and asks the engine nothing",
    asked_engine == nil and board:find("Level leaders", 1, true) ~= nil
        and board:find("1. Hi (Lv 42)", 1, true) ~= nil, board)

calls = {}
framework.enqueue("clock.minute", { kind = "server" }, { minute = 10, hour = 12, weekday = "friday" })
framework.drain()
framework.enqueue("player.chat", { kind = "player", id = "LOW", name = "Lo" }, { message = "!lb" })
framework.drain()
local board2 = said()
check("a scheduled refresh reorders the board",
    board2:find("Level leaders", 1, true) ~= nil
        and board2:find("1. Lo (Lv 90)", 1, true) ~= nil, board2)

calls = {}
framework.enqueue("clock.minute", { kind = "server" }, { minute = 7, hour = 12, weekday = "friday" })
framework.drain()
local off_cadence
for _, call in ipairs(calls) do
    if call.type == "player.stats" then off_cadence = true end
end
check("a minute off the cadence refreshes nothing", off_cadence == nil, off_cadence)

-- The other two boards. Both read from records the server keeps rather than
-- from a body in the world, which is what lets them answer for a player who is
-- not here — and each is led by somebody the level board does not lead with.
-- A fresh caller each time: commands are rate-limited per player, so asking
-- three times as one person would answer once and swallow the rest.
local function board_after(asker, message, title)
    calls = {}
    framework.enqueue("player.chat", { kind = "player", id = asker, name = asker }, { message = message })
    framework.drain()
    -- A board is several messages now, one per line, so the answer is all of
    -- them joined — a check against a single message would only ever see the
    -- heading or one row.
    local lines = {}
    for _, call in ipairs(calls) do
        if call.type == "player.message" then lines[#lines + 1] = call.params.text end
    end
    local answer = table.concat(lines, "\n")
    if answer:find(title, 1, true) then return answer end
    return nil
end

local playtime_board = board_after("ASKA", "!lb playtime", "Most time played")
check("the playtime board ranks by hours played, not by level",
    playtime_board ~= nil and playtime_board:find("1. Lo (10h)", 1, true) ~= nil,
    playtime_board)

local capture_board = board_after("ASKB", "!lb captured", "Most pals captured")
check("the capture board ranks by pals caught",
    capture_board ~= nil and capture_board:find("1. Hi (99 caught)", 1, true) ~= nil,
    capture_board)

local fish_board = board_after("ASKD", "!lb fished", "Most fish caught")
check("the fishing board ranks by fish caught",
    fish_board ~= nil and fish_board:find("1. Lo (40 fish)", 1, true) ~= nil, fish_board)

local craft_board = board_after("ASKE", "!lb crafted", "Most items crafted")
check("the crafting board ranks by items crafted",
    craft_board ~= nil and craft_board:find("1. Hi (70 crafted)", 1, true) ~= nil, craft_board)

local boss_board = board_after("ASKF", "!lb bosses", "Most bosses beaten")
check("the boss board ranks by bosses beaten",
    boss_board ~= nil and boss_board:find("1. Lo (20 bosses)", 1, true) ~= nil, boss_board)

-- The cache is the whole design, so it has to be visible: a board that goes
-- stale silently is indistinguishable from a broken one.
local timed = board_after("ASKH", "!lb captured", "Most pals captured")
check("a board says when it will be read again",
    timed ~= nil and timed:find("next refresh in", 1, true) ~= nil, timed)

local real_clock = os.time
os.time = function() return real_clock() + 240 end
local later = board_after("ASKI", "!lb captured", "Most pals captured")
os.time = real_clock
check("and the countdown shrinks as the refresh approaches",
    later ~= nil and later:find("next refresh in 1m", 1, true) ~= nil, later)

local unknown = board_after("ASKC", "!lb bananas", "No such board")
check("a board nobody has says so rather than answering with the wrong one",
    unknown ~= nil and unknown:find("captured", 1, true) ~= nil, unknown)

-- One board taken away from one player. The rest stay, which is the whole
-- point of a node per board rather than a node for the command.
board_perms:grant("ASKJ", "leaderboards.fished", "deny")
local refused = board_after("ASKJ", "!lb fished", "not allowed to see the fished board")
check("a denied board is refused by name", refused ~= nil, refused)
check("and the refusal offers only boards that player may still see",
    refused ~= nil and refused:find("captured", 1, true) ~= nil
        and refused:find("fished,", 1, true) == nil, refused)

local still = board_after("ASKK", "!lb captured", "Most pals captured")
check("while a board nobody denied still answers", still ~= nil, still)

-- An answer is the only place anybody reads: it names the other boards, and
-- names itself nowhere, since the caller is already looking at it.
check("an answer hints at the other boards",
    still ~= nil and still:find("try: ", 1, true) ~= nil
        and still:find("!lb fished", 1, true) ~= nil, still)
check("and does not offer the board being read",
    still ~= nil and still:find("!lb captured", 1, true) == nil, still)
check("and puts each name on its own line",
    still ~= nil and still:find("\n1%. ") ~= nil, still)

-- The hint obeys the same permissions as the boards themselves.
board_perms:grant("ASKL", "leaderboards.crafted", "deny")
local hinted = board_after("ASKL", "!lb captured", "Most pals captured")
check("a denied board is not hinted at either",
    hinted ~= nil and hinted:find("try: ", 1, true) ~= nil
        and hinted:find("!lb crafted", 1, true) == nil, hinted)

-- A bare !lb is the operator's choice, not a hardcoded level board: a fishing
-- server points it somewhere else entirely.
write(MODS .. "/Leaderboards/settings.config", "default_board = fished\n")
framework.reload_settings()
local defaulted = board_after("ASKM", "!lb", "Most fish caught")
check("a bare !lb follows the operator's default board", defaulted ~= nil, defaulted)

write(MODS .. "/Leaderboards/settings.config", "default_board = bananas\n")
framework.reload_settings()
local nonsense = board_after("ASKN", "!lb", "Level leaders")
check("and a default naming no board falls back rather than refusing",
    nonsense ~= nil, nonsense)
write(MODS .. "/Leaderboards/settings.config", "")
framework.reload_settings()

-- Two players at the same level: the one who got there first ranks higher.
-- LOW reached 90 in the refresh above, so HIGH arriving at 90 now must sort
-- second despite being level-equal.
--
-- The clock is moved by hand because os.time counts whole seconds and this
-- file runs in far less than one — left alone, both level-ups stamp the same
-- second and the tie this is here to test never happens.
local real_time = os.time
os.time = function() return real_time() + 3600 end
levels.HIGH = 90
calls = {}
framework.enqueue("clock.minute", { kind = "server" }, { minute = 20, hour = 12, weekday = "friday" })
framework.drain()
os.time = real_time
local tie = board_after("ASKG", "!lb level", "Level leaders")
check("a level tie is broken by who reached it first",
    tie ~= nil and tie:find("1. Lo (Lv 90)", 1, true) ~= nil
        and tie:find("2. Hi (Lv 90)", 1, true) ~= nil, tie)

-- ── an older install, carried across ────────────────────────────────────────
-- A mod's settings and data used to live inside the folder it was installed
-- from. Upgrading must not quietly revert an operator's tuning, so the first
-- load that finds the old files moves them and says so.
local LEGACY = MODS .. "/Carried"
local CARRIED_HOME = MODS .. "/Palladium/mods/Carried"
mkmod("Carried", [[
return {
    name = "Carried",
    settings = { greeting = "the author's default" },
    data = { notes = { description = "kept", fields = { value = "string" } } },
}
]])
write(LEGACY .. "/settings.config", "greeting = the operator's own\n")
-- A record's kind is the qualified collection name, the way the store writes it.
write(LEGACY .. "/carried.data", "carried.notes\tid=OLD\tvalue=survived\n")

write(MODS .. "/Palladium/mods.list", "Carried\n")
Collections.reset()
Collections.init({ root = ROOT, info = function() end })
Collections.home("bridge", MODS .. "/Palladium")
logged = {}
framework.init({
    collections = Collections,
    permissions = Permissions.new(Collections),
    home_for = function(n) return MODS .. "/Palladium/mods/" .. n end,
    legacy_home_for = function(n) return MODS .. "/" .. n end,
    store = Store,
})
framework.load()

check("an old settings.config is moved into the mod's home under Palladium",
    exists_file(CARRIED_HOME .. "/settings.config")
        and not exists_file(LEGACY .. "/settings.config"))
check("with the operator's value intact, not the author's default",
    framework.mods.Carried.pal.settings.greeting == "the operator's own",
    framework.mods.Carried.pal.settings.greeting)
check("the stored data comes across too, renamed to .data",
    Collections.open("carried.notes"):get("OLD") ~= nil
        and exists_file(CARRIED_HOME .. "/.data")
        and not exists_file(LEGACY .. "/carried.data"))
check("and every move is said out loud",
    table.concat(logged, "\n"):find("moved settings.config into", 1, true) ~= nil,
    table.concat(logged, "\n"))

-- ── a mod's nodes live with the mod ─────────────────────────────────────────
-- Groups and grants stay central because they span every mod; the node
-- declarations belong in the folder of the mod that owns them.
mkmod("Filed", [[
return {
    name = "Filed",
    permissions = {
        { node = "filed.one", description = "the first", default = "deny" },
        { node = "filed.two", description = "the second", default = "allow" },
    },
}
]])
write(MODS .. "/Palladium/mods.list", "Filed\n")
Collections.reset()
Collections.init({ root = ROOT, info = function() end })
Collections.home("bridge", MODS .. "/Palladium")
local split = Permissions.new(Collections)
-- An operator had already changed one default, back when every node lived in
-- the central file.
split.nodes_c:set("filed.one", { default = "allow", description = "the first" })
framework.init({
    collections = Collections,
    permissions = split,
    home_for = function(n) return MODS .. "/Palladium/mods/" .. n end,
    legacy_home_for = function(n) return MODS .. "/" .. n end,
    store = Store,
})
framework.load()

local filed_home = MODS .. "/Palladium/mods/Filed/settings.config"
check("a mod's nodes are written into its own folder, in settings.config",
    exists_file(filed_home))
local filed_text = io.open(filed_home):read("a")
check("with its declarations in them",
    filed_text:find("filed.two = allow", 1, true) ~= nil, filed_text)
check("the operator's earlier default is carried across, not reset",
    filed_text:find("filed.one = allow", 1, true) ~= nil, filed_text)
check("and the central file no longer keeps a second copy",
    split.nodes_c:get("filed.one") == nil)
check("resolution still finds a node now filed under its mod",
    (split:resolve("ANYBODY", "filed.one", {})) == true
        and (split:resolve("ANYBODY", "filed.two", {})) == true)
check("and nodes() still answers with every mod's, merged",
    split:nodes()["filed.one"] ~= nil and split:nodes()["filed.two"] ~= nil)

-- Groups did not move: a grant is not any one mod's business.
local central = io.open(MODS .. "/Palladium/permissions.config"):read("a")
check("groups stay in the central file", central:find("[groups", 1, true) ~= nil)
check("and a mod's nodes are not duplicated there",
    central:find("filed.two", 1, true) == nil, central)

-- ── an upgrade keeps the defaults the operator set ─────────────────────────
-- A mod that kept its nodes in its own permissions.config wrote one section
-- per node. That file is merged into settings.config on upgrade, and appending
-- it verbatim parsed as nothing: every default the operator had set reverted
-- to the mod's own, with only a warning in the log to say so.
mkmod("Carried", [[
return {
    name = "Carried",
    permissions = {
        { node = "carried.one", description = "the first", default = "deny" },
        { node = "carried.two", description = "the second", default = "deny" },
    },
}
]])
local carried_home = MODS .. "/Palladium/mods/Carried"
os.execute("mkdir -p '" .. carried_home .. "'")
write(carried_home .. "/settings.config", "tuning = mine\n")
write(carried_home .. "/permissions.config", [[
; Carried — permission nodes.

[carried.one]
default = allow
description = the first

[carried.two]
default = deny
]])

write(MODS .. "/Palladium/mods.list", "Carried\n")
Collections.reset()
Collections.init({ root = ROOT, info = function() end })
Collections.home("bridge", MODS .. "/Palladium")
local carried = Permissions.new(Collections)
framework.init({
    collections = Collections,
    permissions = carried,
    home_for = function(n) return MODS .. "/Palladium/mods/" .. n end,
    legacy_home_for = function(n) return MODS .. "/" .. n end,
    store = Store,
})
framework.load()

local carried_text = io.open(carried_home .. "/settings.config"):read("a")
check("an upgrade keeps the default the operator set, not the mod's",
    carried_text:find("carried.one = allow", 1, true) ~= nil, carried_text)
check("and the resolver agrees with the file",
    (carried:resolve("ANYBODY", "carried.one", {})) == true
        and (carried:resolve("ANYBODY", "carried.two", {})) == false)
check("their settings are still there beside the nodes",
    carried_text:find("tuning = mine", 1, true) ~= nil, carried_text)
check("and the file it came from is gone, so there is one config per mod",
    not exists_file(carried_home .. "/permissions.config"))
check("the merged nodes parse — a warning would mean they were dropped",
    Collections.problems() == nil or #Collections.problems() == 0,
    Collections.problems() and Collections.problems()[1])

-- ── settings and nodes share one file, and neither eats the other ───────────
-- The file is rewritten whole whenever a node changes. Settings live above the
-- first section, so they are copied through — losing them here would silently
-- reset every mod's tuning the first time anybody touched a permission.
mkmod("Shared", [[
return {
    name = "Shared",
    settings = { greeting = "author's", interval = 5 },
    permissions = { { node = "shared.use", description = "use it", default = "deny" } },
}
]])
local shared_home = MODS .. "/Palladium/mods/Shared"
os.execute("mkdir -p '" .. shared_home .. "'")
write(shared_home .. "/settings.config", "greeting = the operator's\ninterval = 30\n")

write(MODS .. "/Palladium/mods.list", "Shared\n")
Collections.reset()
Collections.init({ root = ROOT, info = function() end })
Collections.home("bridge", MODS .. "/Palladium")
local shared_perms = Permissions.new(Collections)
framework.init({
    collections = Collections,
    permissions = shared_perms,
    home_for = function(n) return MODS .. "/Palladium/mods/" .. n end,
    legacy_home_for = function(n) return MODS .. "/" .. n end,
    store = Store,
})
framework.load()

check("the operator's settings are read from the shared file",
    framework.mods.Shared.pal.settings.greeting == "the operator's"
        and framework.mods.Shared.pal.settings.interval == 30,
    framework.mods.Shared.pal.settings.greeting)

-- Changing a node rewrites the file from scratch; the settings must still be there.
shared_perms:nodes_of("shared"):set("shared.use", { default = "allow", description = "use it" })
local merged = io.open(shared_home .. "/settings.config"):read("a")
check("a node written into it does not take the settings with it",
    merged:find("greeting = the operator's", 1, true) ~= nil
        and merged:find("interval = 30", 1, true) ~= nil, merged)
check("and the node is in there too",
    merged:find("shared.use = allow", 1, true) ~= nil, merged)
check("the file reads clean — settings are not reported as junk",
    #Collections.problems("shared") == 0,
    table.concat(Collections.problems("shared"), " | "))

-- Rewriting it repeatedly must not grow it: the banner and the section's own
-- description are render's, and carrying them through would stack a copy each
-- time anybody touched a permission.
for round = 1, 3 do
    shared_perms:nodes_of("shared"):set("shared.use",
        { default = round % 2 == 1 and "allow" or "deny", description = "use it" })
end
local settled = io.open(shared_home .. "/settings.config"):read("a")
local banners = select(2, settled:gsub("Rewritten whenever", ""))
local descriptions = select(2, settled:gsub("the permission nodes this mod registers", ""))
check("the banner appears once however often the file is rewritten", banners == 1, banners)
check("and so does the section's description", descriptions == 1, descriptions)
check("with the settings still intact after all of it",
    settled:find("greeting = the operator's", 1, true) ~= nil, settled)

-- Read back from disk: what a restart would see.
Collections.reset()
Collections.init({ root = ROOT, info = function() end })
Collections.home("bridge", MODS .. "/Palladium")
local reread = Permissions.new(Collections)
framework.init({ collections = Collections, permissions = reread,
    home_for = function(n) return MODS .. "/Palladium/mods/" .. n end, store = Store })
framework.load()
check("and a restart reads both back",
    framework.mods.Shared.pal.settings.interval == 30
        and (reread:resolve("ANYONE", "shared.use", {})) == true,
    framework.mods.Shared.pal.settings.interval)

say(failures == 0 and "all checks passed" or (failures .. " check(s) failed"))
os.exit(failures == 0 and 0 or 1)
