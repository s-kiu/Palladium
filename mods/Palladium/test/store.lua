-- Store and permission-resolver tests.
--
-- These two hold everything a mod is allowed to remember, inside the game
-- process, so the cases that matter are the unhappy ones: a file torn by a
-- crash, a compaction that has to be atomic, and a resolution order that has
-- to match the one the panel has always used.
--
-- Run: mods/Palladium/test/run-tests.sh

local ROOT = assert(os.getenv("PALLADIUM_TEST_ROOT"), "PALLADIUM_TEST_ROOT is not set")
local SCRIPTS = assert(os.getenv("PALLADIUM_SCRIPTS"), "PALLADIUM_SCRIPTS is not set")
package.path = SCRIPTS .. "/?.lua;" .. package.path

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

local PATH = ROOT .. "/palladium.store"
local function fresh()
    os.remove(PATH)
    return Store.open(PATH)
end

local function file_lines()
    local n = 0
    local file = io.open(PATH, "r")
    if not file then return 0 end
    for _ in file:lines() do n = n + 1 end
    file:close()
    return n
end

say("palladium store")

-- ── records ─────────────────────────────────────────────────────────────────
local store = fresh()
store:put("tag", "UID1:claimed", { uid = "UID1", value = "1786" })
check("a record reads back", store:get("tag", "UID1:claimed").value == "1786")
check("an absent record is nil", store:get("tag", "nope") == nil)
check("an absent kind is an empty table", next(store:all("nothing")) == nil)

store:put("tag", "UID1:claimed", { uid = "UID1", value = "1787" })
check("a second write wins", store:get("tag", "UID1:claimed").value == "1787")
check("and does not count twice", store:count("tag") == 1, store:count("tag"))

check("reopening keeps everything", Store.open(PATH):get("tag", "UID1:claimed").value == "1787")

store:delete("tag", "UID1:claimed")
check("a deleted record is gone", store:get("tag", "UID1:claimed") == nil)
check("and stays gone after a reopen", Store.open(PATH):get("tag", "UID1:claimed") == nil)

-- ── values that could break the format ──────────────────────────────────────
store = fresh()
store:put("tag", "UID2:note", { value = "two\tcolumns\nand a line" })
check("tabs and newlines cannot escape a value",
    Store.open(PATH):get("tag", "UID2:note").value == "two columns and a line",
    Store.open(PATH):get("tag", "UID2:note").value)

store:put("tag", "UID2:eq", { value = "a=b=c" })
check("a value may contain the separator between key and value",
    Store.open(PATH):get("tag", "UID2:eq").value == "a=b=c",
    Store.open(PATH):get("tag", "UID2:eq").value)

-- ── surviving a crash ───────────────────────────────────────────────────────
store = fresh()
store:put("player", "UID3", { name = "Ashen", joins = "1" })
store:put("player", "UID3", { name = "Ashen", joins = "2" })
local file = assert(io.open(PATH, "a"))
file:write("player\tid=UID3\tname=Ashen\tjoin")   -- killed mid-write, no newline
file:close()

local reopened = Store.open(PATH)
check("a line torn by a crash is skipped, not fatal", reopened:get("player", "UID3") ~= nil)
check("and the record keeps its last complete value",
    reopened:get("player", "UID3").joins == "2", reopened:get("player", "UID3").joins)

-- The fragment must also be gone from the file, or the next append runs into
-- it and turns two records into one unreadable line.
reopened:put("player", "UID5", { name = "Bo", joins = "1" })
local healed = Store.open(PATH)
check("the fragment is cleared, so the next write is not corrupted by it",
    healed:get("player", "UID5") ~= nil and healed:get("player", "UID5").name == "Bo",
    healed:get("player", "UID5") and healed:get("player", "UID5").name)
check("and the record written before the crash is still intact",
    healed:get("player", "UID3") ~= nil and healed:get("player", "UID3").joins == "2",
    healed:get("player", "UID3") and healed:get("player", "UID3").joins)

-- ── compaction ──────────────────────────────────────────────────────────────
store = fresh()
for i = 1, 400 do store:put("tag", "UID4:count", { value = tostring(i) }) end
check("rewriting one record many times does not grow the file forever",
    file_lines() < 50, file_lines())
check("and the value survives the compaction",
    Store.open(PATH):get("tag", "UID4:count").value == "400",
    Store.open(PATH):get("tag", "UID4:count").value)
check("no temp file is left behind", io.open(PATH .. ".tmp", "r") == nil)

store = fresh()
for i = 1, 300 do store:put("tag", "UID:" .. i, { value = tostring(i) }) end
check("distinct records are all kept through a compaction", store:count("tag") == 300, store:count("tag"))
check("and are all still there after a reopen", Store.open(PATH):count("tag") == 300)

-- ── a store that cannot write ───────────────────────────────────────────────
-- The dangerous case: reads keep working from memory, so nothing looks wrong
-- until the restart that loses everything.
local complaints = {}
local doomed = Store.open("/proc/nowhere/palladium.store", function(m) complaints[#complaints + 1] = m end)
check("opening an unwritable store says so immediately, not at the first write",
    #complaints == 1 and doomed.failed ~= nil, #complaints)
doomed:put("tag", "UID:x", { value = "1" })
check("and every failed write is reported too", #complaints >= 2, #complaints)
check("reads still answer from memory, which is exactly why it must be loud",
    doomed:get("tag", "UID:x").value == "1")

-- The ordinary case must not be noisy about it.
local quiet = {}
local fine = Store.open(ROOT .. "/deep/nested/palladium.store", function(m) quiet[#quiet + 1] = m end)
check("a store whose directory does not exist yet creates it", fine.failed == nil, fine.failed)
fine:put("tag", "UID:y", { value = "2" })
check("and says nothing when it is working", #quiet == 0, table.concat(quiet, " | "))
check("and what it wrote is really on disk",
    Store.open(ROOT .. "/deep/nested/palladium.store"):get("tag", "UID:y").value == "2")

-- ── choosing where state lives ──────────────────────────────────────────────
-- The standalone case is the one that was broken: no PAL_ROOT, no /palworld,
-- and a store that failed to write without ever saying so.
local host_getenv = os.getenv
os.getenv = function(name)
    if name == "PAL_ROOT" then return nil end
    return host_getenv(name)
end
local root, why = Store.resolve_root("/definitely-not-here")
check("with no PAL_ROOT and no shared volume, it lands beside the server",
    root == "palladium", root)
check("and says why", why:find("not here", 1, true) ~= nil, why)

local shared_root, shared_why = Store.resolve_root(ROOT)
check("with the shared volume present, it uses that", shared_root == ROOT, shared_root)
check("and says so", shared_why:find("volume", 1, true) ~= nil, shared_why)

os.getenv = function(name)
    if name == "PAL_ROOT" then return "/somewhere/explicit" end
    return host_getenv(name)
end
local explicit, explicit_why = Store.resolve_root(ROOT)
check("PAL_ROOT beats both", explicit == "/somewhere/explicit", explicit)
check("and is named as the reason", explicit_why == "PAL_ROOT", explicit_why)
os.getenv = host_getenv

-- ── finding the mods ────────────────────────────────────────────────────────
-- The bug this exists for: a relative "Mods" is resolved against the game's
-- working directory, which is not the folder holding Mods/, so nothing was
-- ever found on a real server. Every test used absolute paths and missed it.
local host_getenv2 = os.getenv
os.getenv = function(name)
    if name == "PALLADIUM_MODS_DIR" then return nil end
    return host_getenv2(name)
end
local dir, how = Store.mods_dir("@/palworld/server/Mods/Palladium/Scripts/main.lua")
check("the mods directory comes from this mod's own path",
    dir == "/palworld/server/Mods", dir)
check("and says where it got it", how == "beside this mod", how)

check("a path that is already relative still answers something usable",
    (Store.mods_dir("@Mods/Palladium/Scripts/main.lua")) == "Mods",
    Store.mods_dir("@Mods/Palladium/Scripts/main.lua"))
check("an unrecognisable source falls back rather than failing",
    (Store.mods_dir("@somewhere/odd.lua")) == "Mods",
    Store.mods_dir("@somewhere/odd.lua"))

os.getenv = function(name)
    if name == "PALLADIUM_MODS_DIR" then return "/explicit/Mods" end
    return host_getenv2(name)
end
check("and an explicit setting beats the derivation",
    (Store.mods_dir("@/palworld/server/Mods/Palladium/Scripts/main.lua")) == "/explicit/Mods")
os.getenv = host_getenv2

say("palladium permissions")

-- ── resolution ──────────────────────────────────────────────────────────────
local function perms()
    local s = fresh()
    os.remove(ROOT .. "/palladium/permissions.config")
    Collections.reset()
    Collections.init({ store = s, root = ROOT, info = function() end })
    return Permissions.new(Collections), s
end

local p = perms()
p:register("goldstreak", { { node = "goldstreak.reward", default = "allow" } })
p:register("kits", { { node = "kits.vip", default = "deny" } })

check("a registered node falls back to its default", p:resolve("UID", "goldstreak.reward") == true)
check("a deny default is honoured", p:resolve("UID", "kits.vip") == false)
check("an unregistered node is denied", p:resolve("UID", "nobody.registered.this") == false)

local _, source = p:resolve("UID", "goldstreak.reward")
check("and the answer says where it came from", source == "default", source)

-- Default group beats the node default.
p:group_set_entry("default", "goldstreak.reward", "deny")
check("the default group beats the node's own default", p:resolve("UID", "goldstreak.reward") == false)

-- A weighted group beats the default group.
p:group_create("vip", "VIP", 10)
p:group_set_entry("vip", "goldstreak.reward", "allow")
p:assign("UID", "vip")
check("a group the player is in beats the default group", p:resolve("UID", "goldstreak.reward") == true)
check("a player not in it is unaffected", p:resolve("OTHER", "goldstreak.reward") == false)

-- Weight decides between two groups.
p:group_create("muted", "", 50)
p:group_set_entry("muted", "goldstreak.reward", "deny")
p:assign("UID", "muted")
check("the highest-weight group wins", p:resolve("UID", "goldstreak.reward") == false)

-- A user override beats every group.
p:grant("UID", "goldstreak.reward", "allow")
check("a personal grant beats every group", p:resolve("UID", "goldstreak.reward") == true)
p:revoke("UID", "goldstreak.reward")
check("and revoking it hands the answer back to the groups", p:resolve("UID", "goldstreak.reward") == false)

-- Specificity and ties.
local q = perms()
q:register("kits", { { node = "kits.daily", default = "deny" } })
q:group_set_entry("default", "*", "allow")
check("a bare wildcard grants", q:resolve("UID", "kits.daily") == true)
q:group_set_entry("default", "kits.*", "deny")
check("a longer wildcard beats a shorter one", q:resolve("UID", "kits.daily") == false)
q:group_set_entry("default", "kits.daily", "allow")
check("an exact node beats every wildcard", q:resolve("UID", "kits.daily") == true)

local r = perms()
r:group_set_entry("default", "kits.daily", "allow")
r:grant("UID", "kits.daily", "deny")
check("deny wins a tie within one source", r:resolve("UID", "kits.daily") == false)

-- ── constraints ─────────────────────────────────────────────────────────────
-- A grant can be narrowed to the calls that satisfy a condition, and the
-- matching happens here so the answer is the same from either door.
local c = perms()
c:register("pal", { { node = "pal.spawn", default = "deny" } })
c:group_set_entry("default", "pal.spawn", "allow", "where species in SheepBall,Lamball")

check("a call that satisfies the constraint is allowed",
    c:resolve("UID", "pal.spawn", { species = "SheepBall" }) == true)
check("one that does not is denied", c:resolve("UID", "pal.spawn", { species = "BOSS_Anubis" }) == false)
local _, _, _, why = c:resolve("UID", "pal.spawn", { species = "BOSS_Anubis" })
check("and says which condition failed", why and why:find("must be one of", 1, true) ~= nil, why)
check("a constrained grant with no parameters at all is denied, not widened",
    c:resolve("UID", "pal.spawn") == false)

c:group_set_entry("default", "player.teleport", "allow", "where x >= 0 and x <= 1000")
c:register("player", { { node = "player.teleport", default = "deny" } })
check("numeric bounds are honoured", c:resolve("UID", "player.teleport", { x = "500" }) == true)
check("and enforced at the edges", c:resolve("UID", "player.teleport", { x = "1001" }) == false)
check("both halves of an and must hold", c:resolve("UID", "player.teleport", { x = "-1" }) == false)

c:group_set_entry("default", "pal.aggro", "allow", "where rare = false")
c:register("pal", { { node = "pal.aggro", default = "deny" } })
check("equality works on non-numbers", c:resolve("UID", "pal.aggro", { rare = "false" }) == true)
check("and rejects the other value", c:resolve("UID", "pal.aggro", { rare = "true" }) == false)

check("an unconstrained grant is unaffected by parameters",
    c:resolve("UID", "kits.nothing", { anything = "1" }) == false)

-- The constraint survives the file, which is where an operator will write it.
local written_handle = assert(io.open(ROOT .. "/palladium/permissions.config", "r"))
local written = written_handle:read("a")
written_handle:close()
check("and the constraint is readable in the file",
    written:find("where species in SheepBall,Lamball", 1, true) ~= nil, written)

-- Roles.
local role = perms()
role:group_create("vip", "VIP", 10)
role:group_create("mod", "MOD", 50)
role:assign("UID", "vip")
check("a role is the tag of the group they are in", role:role("UID") == "VIP", role:role("UID"))
role:assign("UID", "mod")
check("and the highest-weight tagged group wins", role:role("UID") == "MOD", role:role("UID"))
check("a player in no tagged group has no role", role:role("NOBODY") == nil, role:role("NOBODY"))

-- Everything above survives a restart, which is the entire point of the store.
local before = perms()
before:register("kits", { { node = "kits.daily", default = "deny" } })
before:group_create("vip", "VIP", 10)
before:group_set_entry("vip", "kits.daily", "allow")
before:assign("UID", "vip")
Collections.reset()
Collections.init({ store = Store.open(PATH), root = ROOT, info = function() end })
local after = Permissions.new(Collections)
check("groups, grants and nodes all survive a reopen", after:resolve("UID", "kits.daily") == true)
check("and so does the role", after:role("UID") == "VIP", after:role("UID"))

-- ── the file is the state, not a report of it ───────────────────────────────
local CONFIG = ROOT .. "/palladium/permissions.config"
local function read_config()
    local f = io.open(CONFIG, "r"); if not f then return nil end
    local t = f:read("a"); f:close(); return t
end

local f = perms()
f:register("goldstreak", { { node = "goldstreak.reward", description = "earn gold on a streak", default = "allow" } })
f:group_create("vip", "VIP", 10)
f:group_set_entry("vip", "goldstreak.*", "allow")
f:assign("F8EAA197000000000000000000000000", "vip")
f:grant("F8EAA197000000000000000000000000", "kits.daily", "deny")

local text = read_config()
check("permissions land in a file", text ~= nil)
check("nodes are one readable line each with their description",
    text:find("goldstreak.reward = allow", 1, true)
        and text:find("; earn gold on a streak", 1, true), text)
check("groups are sections", text:find("[groups vip]", 1, true) ~= nil, text)
check("with their grants spelled out", text:find("allow = goldstreak.*", 1, true) ~= nil, text)
check("and players carry their membership and overrides",
    text:find("[players F8EAA197000000000000000000000000]", 1, true)
        and text:find("deny = kits.daily", 1, true), text)

-- Editing the file by hand is a first-class way to change permissions.
local handle = assert(io.open(CONFIG, "w"))
handle:write([[
[nodes]
goldstreak.reward = allow

[groups default]
is_default = true
weight = 0

[groups vip]
weight = 10
deny = goldstreak.reward

[players F8EAA197000000000000000000000000]
groups = vip
]])
handle:close()
Collections.reload_changed()
check("a hand edit changes the answer",
    f:resolve("F8EAA197000000000000000000000000", "goldstreak.reward") == false)
check("and a player left out of the edit falls back to the node default",
    f:resolve("SOMEONE_ELSE", "goldstreak.reward") == true)

-- A mod re-registering on every boot must not undo what the operator set.
local edited = perms()
edited:register("kits", { { node = "kits.daily", default = "allow", description = "daily kit" } })
local raw = assert(io.open(CONFIG, "w"))
raw:write("[nodes]\nkits.daily = deny    ; daily kit\n")
raw:close()
Collections.reload_changed()
check("the operator's default is what applies", edited:resolve("UID", "kits.daily") == false)
edited:register("kits", { { node = "kits.daily", default = "allow", description = "daily kit" } })
check("and re-registering the mod does not put it back",
    edited:resolve("UID", "kits.daily") == false, edited.nodes_c:get("kits.daily"))

-- Constraints survive the round trip even though nothing here parses them.
local c = perms()
c:register("pal", { { node = "pal.spawn", default = "deny" } })
c:group_set_entry("default", "pal.spawn", "allow", '{"species":{"in":["SheepBall"]}}')
check("a constraint is written next to its node",
    read_config():find('allow = pal.spawn {"species"', 1, true) ~= nil, read_config())
Collections.reset()
Collections.init({ store = Store.open(PATH), root = ROOT, info = function() end })
local reloaded = Permissions.new(Collections)
local ok_c, _, where_c = reloaded:resolve("UID", "pal.spawn")
check("and comes back intact after a reload",
    ok_c == true and where_c == '{"species":{"in":["SheepBall"]}}', where_c)

say(failures == 0 and "all checks passed" or (failures .. " check(s) failed"))
os.exit(failures == 0 and 0 or 1)
