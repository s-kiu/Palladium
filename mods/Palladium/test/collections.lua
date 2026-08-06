-- Collection tests: declaring, the two storage classes, and the round trip
-- through a file an operator is expected to open and edit.
--
-- Run: mods/Palladium/test/run-tests.sh

local ROOT = assert(os.getenv("PALLADIUM_TEST_ROOT"), "PALLADIUM_TEST_ROOT is not set")
local SCRIPTS = assert(os.getenv("PALLADIUM_SCRIPTS"), "PALLADIUM_SCRIPTS is not set")
package.path = SCRIPTS .. "/?.lua;" .. package.path

local Store = require("store")
local collections = require("collections")

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

local function read(path)
    local file = io.open(path, "r")
    if not file then return nil end
    local text = file:read("a")
    file:close()
    return text
end

local function write(path, text)
    Store.ensure_dir(path:match("^(.*)/[^/]*$"))
    local file = assert(io.open(path, "w"))
    file:write(text)
    file:close()
end

local CONFIG = ROOT .. "/palladium/shop.config"

local function fresh()
    os.remove(CONFIG)
    os.remove(ROOT .. "/palladium.store")
    collections.reset()
    collections.init({
        store = Store.open(ROOT .. "/palladium.store"),
        root = ROOT,
        info = function() end,
    })
end

say("palladium collections")

-- ── declaring ───────────────────────────────────────────────────────────────
fresh()
local listings = collections.declare("shop", "listings", {
    description = "items players have put up for sale",
    fields = { seller = "player", item = "item_id", price = "int" },
})
check("declaring answers a handle", listings ~= nil)
check("a bad owner is refused", collections.declare("Not Valid", "x", {}) == nil)
check("a bad name is refused", collections.declare("shop", "Not Valid", {}) == nil)

local all = collections.all()
check("a declared collection is discoverable",
    #all == 1 and all[1].qualified == "shop.listings", #all)
check("with its shape, so something can render it without knowing it",
    all[1].fields.price == "int" and all[1].storage == "data", all[1].storage)

-- ── data storage ────────────────────────────────────────────────────────────
listings:set("L1", { seller = "UID1", item = "PalSphere", price = "500" })
listings:set("L2", { seller = "UID2", item = "Pan", price = "20" })
check("a record reads back", listings:get("L1").price == "500")
check("the collection counts", listings:count() == 2, listings:count())
check("data records do not create a config file", read(CONFIG) == nil)

listings:delete("L1")
check("and deletes", listings:get("L1") == nil and listings:count() == 1)

-- Data collections live in the append log, so they outlive the process.
collections.reset()
collections.init({ store = Store.open(ROOT .. "/palladium.store"), root = ROOT, info = function() end })
local again = collections.declare("shop", "listings", { fields = {} })
check("a data collection survives a restart", again:get("L2") ~= nil and again:get("L2").item == "Pan",
    again:get("L2"))

-- ── config storage ──────────────────────────────────────────────────────────
fresh()
local groups = collections.declare("shop", "groups", {
    description = "who may trade",
    storage = "config",
    file = "shop",
    fields = { weight = "int", allow = "list" },
})

groups:set("vip", { weight = "10", tag = "VIP", allow = { "shop.sell", "shop.buy" } })
local text = read(CONFIG)
check("a config collection writes a file", text ~= nil)
check("with a section per record", text:find("[groups vip]", 1, true) ~= nil, text)
check("and a line per list entry",
    text:find("allow = shop.sell", 1, true) and text:find("allow = shop.buy", 1, true), text)
check("and says at the top that it is rewritten",
    text:find("Rewritten whenever", 1, true) ~= nil, text)

check("reading a list always answers a table",
    #groups:list("vip", "allow") == 2 and #groups:list("vip", "nothing") == 0)

-- The point of the file: an operator edits it and the mod sees the change.
write(CONFIG, [[
; hand written
[groups vip]
weight = 99
allow = shop.sell
allow = shop.everything

[groups newbie]
weight = 1
]])
local changed = collections.reload_changed()
check("an edit on disk is picked up", #changed == 1 and changed[1] == "shop/shop",
    table.concat(changed, ","))
check("the edited value is what the mod now reads", groups:get("vip").weight == "99",
    groups:get("vip").weight)
check("a record added by hand exists", groups:get("newbie") ~= nil)
check("repeated keys read as a list", #groups:list("vip", "allow") == 2,
    table.concat(groups:list("vip", "allow"), ","))

-- And an API write keeps the hand-added record.
groups:set("vip", { weight = "5" })
local after = read(CONFIG)
check("writing through the API preserves records added by hand",
    after:find("[groups newbie]", 1, true) ~= nil, after)
check("and applies the change", groups:get("vip").weight == "5")

check("no edit means no reload", #collections.reload_changed() == 0)

-- A config collection reloads from its file on a fresh start.
collections.reset()
collections.init({ store = Store.open(ROOT .. "/palladium.store"), root = ROOT, info = function() end })
local reopened = collections.declare("shop", "groups", { storage = "config", file = "shop", fields = {} })
check("a config collection reads its file when it is declared",
    reopened:get("newbie") ~= nil and reopened:get("vip").weight == "5",
    reopened:get("vip"))

-- ── the flat layout ─────────────────────────────────────────────────────────
-- A hundred permission nodes as a hundred sections is a file nobody opens
-- twice; one line each with the description as a comment is readable.
fresh()
local nodes = collections.declare("shop", "nodes", {
    storage = "config",
    file = "shop",
    layout = "flat",
    value_field = "default",
    comment_field = "description",
    fields = { default = "string" },
})
nodes:set("shop.sell", { default = "allow", description = "put items up for sale" })
nodes:set("shop.buy", { default = "deny", description = "buy from the shop" })
local flat = read(CONFIG)
check("the flat layout is one line per record",
    flat:find("shop.sell = allow", 1, true) ~= nil, flat)
check("with the description as a trailing comment",
    flat:find("; put items up for sale", 1, true) ~= nil, flat)
check("under a single section", select(2, flat:gsub("%[nodes%]", "")) == 1, flat)

write(CONFIG, "[nodes]\nshop.sell = deny    ; put items up for sale\n")
collections.reload_changed()
check("and it reads back after a hand edit", nodes:get("shop.sell").default == "deny",
    nodes:get("shop.sell"))
check("with the description intact, not emptied by the edit",
    nodes:get("shop.sell").description == "put items up for sale",
    nodes:get("shop.sell").description)

-- ── rendering is stable ─────────────────────────────────────────────────────
-- An unchanged state must produce a byte-identical file, or every save looks
-- like an external edit and the two fight each other.
fresh()
local stable = collections.declare("shop", "groups", { storage = "config", file = "shop", fields = {} })
stable:set("b", { weight = "2" })
stable:set("a", { weight = "1" })
local first = read(CONFIG)
stable:set("a", { weight = "1" })
check("writing the same state twice produces the same file", read(CONFIG) == first)
check("and records come out in a stable order",
    first:find("[groups a]", 1, true) < first:find("[groups b]", 1, true), first)

-- ── telling you when the file is wrong ──────────────────────────────────────
-- A format people edit by hand has to answer back. Nothing here is fatal:
-- what parses is loaded, the rest is reported, because one bad line must never
-- cost somebody their whole permissions file.
fresh()
local checked = collections.declare("shop", "groups", {
    storage = "config", file = "shop",
    fields = { weight = "int", tag = "string", is_default = "bool" },
})
write(CONFIG, [[
[groups vip]
weight = 10

[groupz oops]
weight = 1

[groups typo]
wieght = 3

[groups wrongtype]
weight = banana
is_default = perhaps

this line is not a pair
]])
collections.reload_changed()
local problems = table.concat(collections.problems("shop"), "\n")

check("a section naming no collection is reported",
    problems:find("no collection groupz", 1, true) ~= nil, problems)
check("and the near miss is named, because it is almost always a typo",
    problems:find("did you mean groups", 1, true) ~= nil, problems)
check("a field the collection does not declare is reported",
    problems:find("wieght is not a field of groups", 1, true) ~= nil, problems)
check("with its near miss too", problems:find("did you mean weight", 1, true) ~= nil, problems)
check("a value of the wrong type is reported",
    problems:find("weight = banana is not a int", 1, true) ~= nil, problems)
check("including bools", problems:find("is_default = perhaps must be true or false", 1, true) ~= nil,
    problems)
check("a line that is not key = value is reported",
    problems:find("not `key = value`", 1, true) ~= nil, problems)
check("and every report names its line number",
    problems:find("line 4", 1, true) ~= nil, problems)

-- The good records still load: reporting is not refusing.
check("what parses is still loaded", checked:get("vip").weight == "10", checked:get("vip"))
check("including records that merely had a bad field",
    checked:get("typo") ~= nil, checked:get("typo"))

write(CONFIG, "[groups vip]\nweight = 10\n")
collections.reload_changed()
check("and a clean file reports nothing", #collections.problems("shop") == 0,
    table.concat(collections.problems("shop"), " | "))

say(failures == 0 and "all checks passed" or (failures .. " check(s) failed"))
os.exit(failures == 0 and 0 or 1)
