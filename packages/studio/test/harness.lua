-- The studio's engine harness, run under plain Lua 5.4 — the same interpreter
-- class the server embeds — against the generated engine copies the page
-- ships. What passes here is exactly what the browser executes; the only
-- thing left for a browser to break is fengari itself.
--
-- Run: lua5.4 docs/studio/test/harness.lua

local HERE = (arg and arg[0] or ""):match("^(.*)/[^/]+$") or "."
local STUDIO = HERE .. "/.."

-- Everything is read from disk up front: the first boot replaces io.open with
-- the in-memory filesystem, and after that the real disk is out of reach.
local function slurp(path)
    local file = assert(io.open(path, "r"), "cannot read " .. path)
    local text = file:read("a")
    file:close()
    return text
end

STUDIO_SOURCES = {
    store = slurp(STUDIO .. "/engine/store.lua"),
    collections = slurp(STUDIO .. "/engine/collections.lua"),
    permissions = slurp(STUDIO .. "/engine/permissions.lua"),
    framework = slurp(STUDIO .. "/engine/framework.lua"),
    capabilities = slurp(STUDIO .. "/engine/capabilities.lua"),
}
MEMFS = dofile(STUDIO .. "/memfs.lua")
dofile(STUDIO .. "/boot.lua")

local failures = 0
local function check(name, condition, detail)
    if condition then
        io.write("  ok   ", name, "\n")
    else
        failures = failures + 1
        io.write("  FAIL ", name, "\n       ", tostring(detail), "\n")
    end
end

-- ── a decoder for the studio's own JSON ─────────────────────────────────────
-- Just enough for what the encoder emits: objects, arrays, strings with the
-- five named escapes and \uXXXX, numbers, booleans, null.

local decode

local function decode_string(text, at)
    local out = {}
    at = at + 1
    while true do
        local c = text:sub(at, at)
        if c == '"' then return table.concat(out), at + 1 end
        if c == "\\" then
            local n = text:sub(at + 1, at + 1)
            if n == "u" then
                out[#out + 1] = string.char(tonumber(text:sub(at + 2, at + 5), 16) % 256)
                at = at + 6
            else
                local map = { n = "\n", r = "\r", t = "\t" }
                out[#out + 1] = map[n] or n
                at = at + 2
            end
        else
            out[#out + 1] = c
            at = at + 1
        end
    end
end

decode = function(text, at)
    at = at or 1
    local c = text:sub(at, at)
    if c == '"' then return decode_string(text, at) end
    if c == "{" then
        local out = {}
        at = at + 1
        if text:sub(at, at) == "}" then return out, at + 1 end
        while true do
            local key, value
            key, at = decode_string(text, at)
            at = at + 1 -- ':'
            value, at = decode(text, at)
            out[key] = value
            if text:sub(at, at) == "}" then return out, at + 1 end
            at = at + 1 -- ','
        end
    end
    if c == "[" then
        local out = {}
        at = at + 1
        if text:sub(at, at) == "]" then return out, at + 1 end
        while true do
            local value
            value, at = decode(text, at)
            out[#out + 1] = value
            if text:sub(at, at) == "]" then return out, at + 1 end
            at = at + 1 -- ','
        end
    end
    if text:sub(at, at + 3) == "true" then return true, at + 4 end
    if text:sub(at, at + 4) == "false" then return false, at + 5 end
    if text:sub(at, at + 3) == "null" then return nil, at + 4 end
    local number = text:match("^-?%d+%.?%d*[eE]?[-+]?%d*", at)
    return tonumber(number), at + #number
end

local function ask(request)
    local reply = studio(request)
    local value = decode(reply)
    return value, reply
end

local function group_named(reply, name)
    for _, group in ipairs(reply.groups or {}) do
        if group.name == name then return group end
    end
    return nil
end

-- ── a virgin boot seeds the five tiers ──────────────────────────────────────
io.write("studio harness\n")

ask("op=reset")
local fresh = ask("op=boot")
check("a virgin boot answers ok", fresh.ok == true, studio("op=boot"))
check("and seeds five groups", #fresh.groups == 5, #fresh.groups)
local default_group
for _, group in ipairs(fresh.groups) do
    if group.is_default then default_group = group.name end
end
check("one of them is the default everybody is in", default_group ~= nil)
check("and the config reads clean", #fresh.problems == 0, fresh.problems[1])

local has_capability_row = false
for _, node in ipairs(fresh.nodes) do
    if node.id == "player.teleport" and node.capability then has_capability_row = true end
end
check("capability nodes appear beside registered ones", has_capability_row)

-- ── the matrix separates may / may-on-self / may-not ────────────────────────
local matrix = ask("op=matrix")
check("the matrix answers ok", matrix.ok == true)

local function cell(m, group, node)
    return (m.cells[group] or {})[node]
end

check("admins may teleport outright",
    cell(matrix, "admins", "player.teleport").allowed == true)
check("the default tier may not",
    cell(matrix, default_group, "player.teleport").allowed == false
        and cell(matrix, default_group, "player.teleport").self == false)
local member_stats = cell(matrix, "member", "player.stats")
check("member may read stats only as a self-call",
    member_stats.allowed == false and member_stats.self == true, studio("op=matrix"))
check("and the cell names the group that decided",
    member_stats.source == "group:member", member_stats.source)
check("player.records rides in the member tier the same way",
    cell(matrix, "member", "player.records").self == true)

-- ── render → reboot → identical answers ─────────────────────────────────────
local first = ask("op=render")
check("render hands back a config", first.config:find("%[groups") ~= nil)
local matrix_json_1 = studio("op=matrix")

ask("op=reset")
studio("op=file\ttext=" .. first.config:gsub("\n", "\n")) -- newlines survive: only tabs delimit
-- Tabs are the field separators, so the config travels through MEMFS instead
-- of through the request when it contains one; here it never does.
local again = ask("op=boot")
check("a rendered config boots back clean", again.ok == true and #again.problems == 0,
    again.problems and again.problems[1])
local second = ask("op=render")
check("and unchanged state renders byte-identical", second.config == first.config)
check("and every matrix answer survives the round trip", studio("op=matrix") == matrix_json_1)

-- ── config mistakes answer back ─────────────────────────────────────────────
ask("op=reset")
-- The rendered file carries no trailing newline, so the garbage gets one of
-- its own — glued to the last line it would hide inside a comment.
studio("op=file\ttext=" .. first.config .. "\nthis line is not a pair\n")
local mangled = ask("op=boot")
check("a mangled line is reported, not swallowed", #mangled.problems > 0)
check("with its line number", tostring(mangled.problems[1]):find("line %d") ~= nil,
    mangled.problems[1])

-- ── CRLF input is tolerated ─────────────────────────────────────────────────
ask("op=reset")
studio("op=file\ttext=" .. first.config:gsub("\n", "\r\n"))
local windows = ask("op=boot")
check("a CRLF config reads clean", windows.ok == true and #windows.problems == 0,
    windows.problems and windows.problems[1])
check("and comes back with plain newlines", ask("op=render").config == first.config)

-- ── edits go through the real API and land in the file ──────────────────────
ask("op=reset")
studio("op=file\ttext=" .. first.config)
ask("op=boot")

local entry = ask("op=entry\tgroup=" .. default_group ..
    "\tnode=player.heal\teffect=allow\twhere=where target = @me")
check("a group entry with a constraint is accepted", entry.ok == true, entry.error)
local after = ask("op=matrix")
local healed = cell(after, default_group, "player.heal")
check("and the matrix reflects it as self-only", healed.allowed == false and healed.self == true)
check("and the rendered file carries the constraint",
    ask("op=render").config:find("allow = player%.heal where target = @me") ~= nil)

-- A constraint no probe can satisfy — the cell must read as conditional, not
-- as a plain no: "may spawn Lamballs" collapsed into "may not spawn" is the
-- matrix lying in the strict direction.
ask("op=entry\tgroup=vip\tnode=pal.spawn\teffect=allow\twhere=where species in Lamball")
local sheep = cell(ask("op=matrix"), "vip", "pal.spawn")
check("a species-constrained allow reads as conditional",
    sheep.allowed == false and sheep.self == false and sheep.conditional == true,
    studio("op=matrix"):match('"pal%.spawn":{[^}]*}'))
check("and carries the rule and the reason the bare call fails",
    sheep.where:find("species in Lamball", 1, true) ~= nil
        and sheep.why:find("species", 1, true) ~= nil,
    sheep.where .. " / " .. sheep.why)
ask("op=entry_remove\tgroup=vip\tnode=pal.spawn")

local defaulted = ask("op=set_default\tnode=player.records\teffect=allow")
check("a node default can be flipped", defaulted.ok == true)
check("and takes effect for the bottom tier",
    cell(ask("op=matrix"), default_group, "player.records").allowed == true)

local made = ask("op=group_new\tname=streamer\tweight=7\ttag=LIVE")
check("a new group can be made", made.ok == true, made.error)
check("and shows up weighted and tagged",
    group_named(ask("op=info"), "streamer").weight == 7)

-- ── the simulator speaks with the server's own voice ────────────────────────
ask("op=player\tid=AAAA0000000000000000000000000001\tname=Hero\tgroups=vip")
ask("op=player\tid=BBBB0000000000000000000000000002\tname=Sidekick\tgroups=" .. default_group)

local healed_self = ask("op=simulate\tactor=AAAA0000000000000000000000000001\tline=!heal")
check("a vip healing themselves is executed",
    healed_self.executed ~= nil and healed_self.executed.action == "player.heal",
    studio("op=simulate\tactor=AAAA0000000000000000000000000001\tline=!heal"))
check("targeting themselves",
    healed_self.executed.target == "AAAA0000000000000000000000000001")

local healed_other = ask("op=simulate\tactor=AAAA0000000000000000000000000001\tline=!heal @Sidekick")
check("healing somebody else is refused", healed_other.executed == nil)
check("with the constraint spelled out",
    tostring(healed_other.messages[1] and healed_other.messages[1].text):find("target") ~= nil,
    healed_other.messages[1] and healed_other.messages[1].text)

local nobody = ask("op=simulate\tactor=AAAA0000000000000000000000000001\tline=!heal @Nobody")
check("a name nobody carries is named back",
    tostring(nobody.messages[1] and nobody.messages[1].text):find("no player named Nobody") ~= nil,
    nobody.messages[1] and nobody.messages[1].text)

local guest_heal = ask("op=simulate\tactor=BBBB0000000000000000000000000002\tline=!teleport x=1 y=2 z=3")
check("the bottom tier is refused a capability outright", guest_heal.executed == nil)

local words = ask("op=simulate\tactor=AAAA0000000000000000000000000001\tline=!commands")
check("!commands answers", words.messages[1] ~= nil)

local plain = ask("op=simulate\tactor=AAAA0000000000000000000000000001\tline=hello there")
check("plain chat is not a command", plain.handled == false and plain.messages[1] == nil)

check("and simulation left the config untouched",
    ask("op=render").config == ask("op=render").config
        and ask("op=render").config:find("AAAA0000", 1, true) == nil)

-- ── the lens: one player, every node, with the deciding entry as text ───────
local REAL = "CCCC0000000000000000000000000003"
ask("op=assign\tplayer=" .. REAL .. "\tgroup=vip")
ask("op=grant\tplayer=" .. REAL .. "\tnode=pal.spawn\teffect=allow" ..
    "\twhere=where species in Lamball\tuntil_stamp=2030-06-01")

local listed = false
for _, row in ipairs(ask("op=info").players) do
    if row.id == REAL and row.groups:find("vip", 1, true) and row.overrides == 1 then
        listed = true
    end
end
check("a player the config names is listed with groups and overrides", listed,
    studio("op=info"):match('"players":%b[]'))

local lens = ask("op=lens\tplayer=" .. REAL)
check("the lens reports their standing", lens.standing == "vip" and lens.weight == 8,
    lens.standing)
check("and their override, date included",
    lens.overrides[1] and lens.overrides[1].node == "pal.spawn"
        and lens.overrides[1].until_stamp == "2030-06-01",
    studio("op=lens\tplayer=" .. REAL):match('"overrides":%b[]'))

local by_id = {}
for _, row in ipairs(lens.rows) do by_id[row.id] = row end
check("their override outranks every group",
    by_id["pal.spawn"].conditional == true and by_id["pal.spawn"].source == "user",
    by_id["pal.spawn"].source)
check("their tier answers where no override speaks",
    by_id["player.heal"].self == true and by_id["player.heal"].source == "group:vip",
    by_id["player.heal"].source)

-- A simulated player through the same lens: groups applied for the question,
-- the file put back after.
ask("op=player\tid=DDDD0000000000000000000000000004\tname=Ghost\tgroups=moderator")
local ghost = ask("op=lens\tplayer=DDDD0000000000000000000000000004")
local ghost_rows = {}
for _, row in ipairs(ghost.rows) do ghost_rows[row.id] = row end
check("a simulated player reads through their pretend groups",
    ghost.simulated == true and ghost_rows["player.heal"].allowed == true,
    ghost_rows["player.heal"].source)
check("and is not written into the config by asking",
    ask("op=render").config:find("DDDD0000", 1, true) == nil)

-- ── staged mods load like a server loads them ───────────────────────────────
local TINY = [[
return {
    name = "Tiny",
    version = "1.0.0",
    description = "the harness's own mod",
    permissions = {
        { node = "tiny.ping", description = "answer a ping", default = "allow" },
    },
    commands = {
        ["!ping"] = {
            node = "tiny.ping",
            help = "!ping - pong.",
            run = function(event, _args, pal)
                pal.player.message(event.subject.id, { text = "pong " .. (event.subject.name or "") })
            end,
        },
    },
}
]]

ask("op=reset")
studio("op=mod\tname=Tiny\tfile=mod.lua\ttext=" .. TINY)
studio("op=mod\tname=Busted\ttext=this is not lua {{{")
local modded = ask("op=boot")

local tiny, busted
for _, mod in ipairs(modded.mods) do
    if mod.name == "Tiny" then tiny = mod end
    if mod.name == "Busted" then busted = mod end
end
check("a staged mod loads with its command", tiny ~= nil and tiny.ok == true
    and tiny.commands[1] and tiny.commands[1].word == "!ping"
    and tiny.commands[1].node == "tiny.ping",
    studio("op=boot"):match('"mods":%b[]'))
check("a broken mod is refused with the reason, not silently dropped",
    busted ~= nil and busted.ok == false and busted.error ~= "", busted and busted.error)

-- Nodes live with their mod now, so the central file is not where this lands.
local rendered = ask("op=render")
local tiny_file
for _, file in ipairs(rendered.files) do
    if file.path:find("/Tiny/", 1, true) then tiny_file = file end
end
check("its node registered itself into the mod's own file",
    tiny_file ~= nil and tiny_file.text:find("tiny.ping = allow", 1, true) ~= nil,
    tiny_file and tiny_file.text)
check("and the central file keeps the groups, not the mod's nodes",
    rendered.config:find("tiny.ping", 1, true) == nil, rendered.config)

local tiny_cell = cell(ask("op=matrix"), default_group, "tiny.ping")
check("and the matrix answers for it — allow-by-default reaches everybody",
    tiny_cell ~= nil and tiny_cell.allowed == true, tiny_cell and tiny_cell.source)

ask("op=player\tid=EEEE0000000000000000000000000005\tname=Pinger\tgroups=" .. default_group)
local ping = ask("op=simulate\tactor=EEEE0000000000000000000000000005\tline=!ping")
check("the mod's command answers in the simulator",
    ping.messages[1] ~= nil and ping.messages[1].text:find("pong Pinger", 1, true) ~= nil,
    ping.messages[1] and ping.messages[1].text)

-- A read-only question re-boots the engine to undo its scaffolding. That must
-- not also undo an edit: a mod's node default is regenerated from the mod's
-- own declaration unless its file is put back first.
ask("op=set_default\tnode=tiny.ping\teffect=deny")
ask("op=matrix")
ask("op=lens\tplayer=" .. REAL)
local after_questions
for _, file in ipairs(ask("op=render").files) do
    if file.path:find("/Tiny/", 1, true) then after_questions = file.text end
end
check("an edit to a mod's node survives the questions asked after it",
    after_questions ~= nil and after_questions:find("tiny.ping = deny", 1, true) ~= nil,
    after_questions)

-- ── a live server's files, without the mods that wrote them ─────────────────
-- The panel hands over the central file and every mod's node file, but not
-- the mod.lua behind any of them. The studio must still show and edit that
-- inventory, or a connected operator sees less than an offline one.
ask("op=reset")
studio("op=file\ttext=" .. first.config)
studio("op=home_file\tname=Shopkeep\ttext=" .. table.concat({
    "[nodes]",
    "shopkeep.buy = allow    ; buy from the shop",
    "shopkeep.sell = deny    ; sell to the shop",
    "",
}, "\n"))
local served = ask("op=boot")

local seen_buy, seen_sell
for _, node in ipairs(served.nodes) do
    if node.id == "shopkeep.buy" then seen_buy = node end
    if node.id == "shopkeep.sell" then seen_sell = node end
end
check("a mod's nodes are read even with no mod.lua to declare them",
    seen_buy ~= nil and seen_sell ~= nil, studio("op=info"):match('"nodes":%b[]'))
check("with the defaults the file gives them",
    seen_buy.default == "allow" and seen_sell.default == "deny",
    seen_buy and seen_buy.default)
check("and they answer in the matrix",
    cell(ask("op=matrix"), default_group, "shopkeep.buy").allowed == true)

local wrote = ask("op=set_default\tnode=shopkeep.sell\teffect=allow")
check("editing one names the file it belongs to, not the central one",
    wrote.mod == "Shopkeep"
        and wrote.file == "Palladium/mods/Shopkeep/settings.config", wrote.file)
local shop_text
for _, file in ipairs(ask("op=render").files) do
    if file.name == wrote.file then shop_text = file.text end
end
check("and that file is what carries the change",
    shop_text ~= nil and shop_text:find("shopkeep.sell = allow", 1, true) ~= nil, shop_text)
check("while the central file stays out of it",
    ask("op=render").config:find("shopkeep", 1, true) == nil)

-- ── what the five tabs are built on ─────────────────────────────────────────
ask("op=reset")
studio("op=file\ttext=" .. first.config)
studio("op=mod\tname=Shop\tfile=mod.lua\ttext=" .. [[
return {
    name = "Shop",
    version = "2.1.0",
    description = "buying and selling",
    settings = { currency = "Money", markup = 10 },
    data = { listings = { description = "what is for sale", fields = { price = "int" } } },
    permissions = { { node = "shop.buy", description = "buy", default = "allow" } },
    commands = {
        ["!buy"] = {
            node = "shop.buy",
            help = "!buy <item> [count] — buy from the shop.",
            target = "player",
            params = {
                { name = "item", kind = "item_id", required = true },
                { name = "count", kind = "int", min = 1, max = 99, default = 1 },
            },
            run = function(event, _args, pal, params)
                pal.data("listings"):set(params.item, { price = tostring(params.count) })
                pal.player.message(event.subject.id, { text = "bought " .. params.item })
            end,
        },
    },
}
]])
studio("op=mod\tname=Wrecked\tfile=mod.lua\ttext=this is not lua {{{")
ask("op=boot")

local over = ask("op=overview")
local shop_row, wrecked_row
for _, mod in ipairs(over.mods) do
    if mod.name == "Shop" then shop_row = mod end
    if mod.name == "Wrecked" then wrecked_row = mod end
end
check("overview lists a healthy mod with what it declares",
    shop_row ~= nil and shop_row.ok == true and shop_row.version == "2.1.0"
        and shop_row.counts.commands == 1 and shop_row.counts.nodes == 1
        and shop_row.counts.collections == 1,
    shop_row and studio("op=overview"):sub(1, 300))
check("and says which of its files are there",
    (function()
        for _, f in ipairs(shop_row.files) do
            if f.name == "settings.config" and f.present and f.bytes > 0 then return true end
        end
    end)(), studio("op=overview"):sub(1, 300))
check("a mod that would not load is listed with the reason, not hidden",
    wrecked_row ~= nil and wrecked_row.ok == false and #wrecked_row.troubles > 0,
    wrecked_row and wrecked_row.troubles[1])

local cmds = ask("op=commands")
local buy, capability
for _, c in ipairs(cmds.commands) do
    if c.word == "!buy" then buy = c end
    if c.word == "!player.give_item" then capability = c end
end
check("commands carries a mod's own word with its parameters",
    buy ~= nil and buy.source == "Shop" and buy.node == "shop.buy"
        and buy.params[1].name == "item" and buy.params[1].required == true,
    buy and studio("op=commands"):sub(1, 200))
check("and every capability beside it", capability ~= nil and capability.kind == "capability")

-- Simulating a command deliberately leaves nothing behind, so this asks what
-- the Data tab is really for: every declared collection, listed with what the
-- mod said it was, whether or not anything is in it yet.
local data = ask("op=data")
local listings
for _, collection in ipairs(data.collections) do
    if collection.name == "shop.listings" then listings = collection end
end
check("data lists a mod's declared collection",
    listings ~= nil and listings.storage == "data", listings and listings.storage)
check("with the owner and description the mod declared",
    listings.owner == "shop" and listings.description == "what is for sale")

local settings = ask("op=settings")
local shop_settings
for _, mod in ipairs(settings.mods) do
    if mod.mod == "Shop" then shop_settings = mod end
end
check("settings lists every mod's, defaults included", shop_settings ~= nil
    and #shop_settings.settings >= 2, shop_settings and #shop_settings.settings)

local wrote_setting = ask("op=set_setting\tmod=Shop\tkey=markup\tvalue=25")
check("a setting can be changed, and names the file it went to",
    wrote_setting.ok == true
        and wrote_setting.file == "Palladium/mods/Shop/settings.config", wrote_setting.file)
ask("op=matrix") -- a question re-boots; the change must survive it
local after_settings = ask("op=settings")
for _, mod in ipairs(after_settings.mods) do
    if mod.mod == "Shop" then
        for _, row in ipairs(mod.settings) do
            if row.key == "markup" then
                check("and it survives the next question asked", row.value == "25", row.value)
                check("and is marked as the operator's, not the author's", row.overridden == true)
            end
        end
    end
end
check("changing a setting leaves the mod's nodes alone",
    (function()
        for _, file in ipairs(ask("op=render").files) do
            if file.name:find("Shop/settings.config", 1, true) then
                return file.text:find("shop.buy = allow", 1, true) ~= nil
            end
        end
    end)(), studio("op=render"):sub(1, 400))

io.write(failures == 0 and "all checks passed\n" or (failures .. " check(s) failed\n"))
os.exit(failures == 0 and 0 or 1)
