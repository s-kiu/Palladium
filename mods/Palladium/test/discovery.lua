-- How mods are found on hosts that offer no help: a Windows shell that has no
-- `ls`, an iterate tree keyed by names rather than paths, and — when all of it
-- fails — the list file an operator writes by hand. Runs the real framework
-- with those worlds faked, one per fresh Lua state via dofile.

local SCRIPTS = os.getenv("PALLADIUM_SCRIPTS") or "Scripts"
local ROOT = os.getenv("PALLADIUM_TEST_ROOT") or error("PALLADIUM_TEST_ROOT not set")
local MODS = ROOT .. "/Mods"

local failures = 0
local function check(name, condition, detail)
    if condition then
        io.write("  ok   ", name, "\n")
    else
        failures = failures + 1
        io.write("  FAIL ", name, "\n       ", tostring(detail), "\n")
    end
end

os.execute("mkdir -p '" .. MODS .. "/Palladium' '" .. MODS .. "/Thing'")
local mod = io.open(MODS .. "/Thing/mod.lua", "w")
mod:write('return { name = "Thing", commands = {}, permissions = {} }\n')
mod:close()

-- Loading framework.lua fresh under a chosen personality: package.config
-- decides the shell branch at load time, exactly as on a real host.
local function boot_with(config_head, popen, iterate)
    local saved_config, saved_popen = package.config, io.popen
    local saved_iterate = rawget(_G, "IterateGameDirectories")
    package.config = config_head .. package.config:sub(2)
    io.popen = popen
    if iterate ~= nil then IterateGameDirectories = iterate else IterateGameDirectories = nil end

    -- The fakes must outlive load(): the shell branch is chosen when the file
    -- loads, but the listing itself runs inside framework.load().
    local chunk = assert(loadfile(SCRIPTS .. "/framework.lua"))
    local framework = chunk()
    local seen = {}
    framework.init({
        info = function(line) seen[#seen + 1] = tostring(line) end,
        mods_dir = MODS,
        home_for = function(n) return MODS .. "/Palladium/mods/" .. n end,
        legacy_home_for = function(n) return MODS .. "/" .. n end,
    })
    local ran, trouble = pcall(framework.load)

    package.config = saved_config
    io.popen = saved_popen
    IterateGameDirectories = saved_iterate
    if not ran then error(trouble, 0) end
    return framework, table.concat(seen, "\n")
end

-- ── a cmd.exe host lists folders with dir /b, not ls ─────────────────────────
local asked
local fake_cmd_popen = function(command)
    asked = command
    if not command:match('^dir /b /ad "') then return nil end
    -- what cmd prints for the folder this test built
    local lines = { "Palladium", "Thing" }
    local at = 0
    return {
        lines = function() return function() at = at + 1; return lines[at] end end,
        close = function() return true end,
    }
end
local fw, log = boot_with("\\", fake_cmd_popen, nil)
check("a cmd host is asked with dir /b, not ls",
    asked and asked:match('^dir /b /ad "') ~= nil, asked)
check("and the path handed to cmd carries no forward slash",
    asked and not asked:match('"[^"]*/'), asked)
check("the sibling mod is found and loaded",
    fw.mods.Thing and fw.mods.Thing.ok == true,
    fw.mods.Thing and fw.mods.Thing.error or log)
check("and Palladium itself is not treated as a mod",
    fw.mods.Palladium == nil)

-- ── the iterate tree is keyed by name, not by path ───────────────────────────
-- The cmd boot above wrote its findings back; this boot is about the tree.
os.remove(MODS .. "/Palladium/mods.list")
local by_name = { Mods = { Palladium = {}, Thing = {} } }
local fw2, log2 = boot_with("/", function() return nil end, function() return by_name end)
check("an absolute mods path still matches the tree by its own name",
    fw2.mods.Thing and fw2.mods.Thing.ok == true,
    fw2.mods.Thing and fw2.mods.Thing.error or log2)
check("and it really was the iterate tree that answered",
    log2:find("via IterateGameDirectories", 1, true) ~= nil, log2)

-- ── every route dead: the log says exactly what to write, and the list file works ──
os.remove(MODS .. "/Palladium/mods.list")
local fw3, log3 = boot_with("\\", function() return nil end, nil)
check("with no route at all, nothing loads",
    fw3.mods.Thing == nil, log3)
check("and the log names the list file as the way out",
    log3:find("mods.list", 1, true) ~= nil, log3)

local list = io.open(MODS .. "/Palladium/mods.list", "w")
list:write("Thing\n")
list:close()
local fw4, log4 = boot_with("\\", function() return nil end, nil)
check("a hand-written mods.list is believed with no shell and no iterate",
    fw4.mods.Thing and fw4.mods.Thing.ok == true,
    fw4.mods.Thing and fw4.mods.Thing.error or log4)

-- ── names from UE4SS's own mods.txt, with no shell and no iterate ───────────
os.remove(MODS .. "/Palladium/mods.list")
local txt = io.open(MODS .. "/mods.txt", "w")
txt:write("Palladium : 1\nThing : 1\nGhost : 1\nSwitched : 0\n")
txt:close()
os.execute("mkdir -p '" .. MODS .. "/Switched'")
local sw = io.open(MODS .. "/Switched/mod.lua", "w")
sw:write('return { name = "Switched", commands = {}, permissions = {} }\n')
sw:close()
local fw5, log5 = boot_with("\\", function() return nil end, nil)
check("mods.txt names are probed when no listing exists",
    fw5.mods.Thing and fw5.mods.Thing.ok == true,
    fw5.mods.Thing and fw5.mods.Thing.error or log5)
check("a name with no mod.lua behind it is not a mod",
    fw5.mods.Ghost == nil)
check("a `: 0` line stays disabled here too",
    fw5.mods.Switched == nil, log5)

-- ── one good scan writes the list; the next boot needs no routes at all ─────
check("what the scan found was written back as mods.list",
    (function()
        local file = io.open(MODS .. "/Palladium/mods.list", "r")
        if not file then return false end
        local text = file:read("a"); file:close()
        return text:find("Thing", 1, true) ~= nil and text:find("via", 1, true) ~= nil
            or text:find("Thing", 1, true) ~= nil
    end)())
os.remove(MODS .. "/mods.txt")
local fw6, log6 = boot_with("\\", function() return nil end, nil)
check("the next boot loads from that file with every route dead",
    fw6.mods.Thing and fw6.mods.Thing.ok == true,
    fw6.mods.Thing and fw6.mods.Thing.error or log6)
check("and via mods.list, so the scan is no longer consulted",
    log6:find("via mods.list", 1, true) ~= nil, log6)

-- ── the operator's own file is never overwritten by a scan ──────────────────
local hand = io.open(MODS .. "/Palladium/mods.list", "w")
hand:write("; mine\nThing\n")
hand:close()
local cmd_popen_again = function(command)
    if not command:match('^dir /b /ad "') then return nil end
    local lines = { "Palladium", "Thing", "Switched" }
    local at = 0
    return {
        lines = function() return function() at = at + 1; return lines[at] end end,
        close = function() return true end,
    }
end
local fw7 = boot_with("\\", cmd_popen_again, nil)
check("a hand-written list is believed over a scan that sees more",
    fw7.mods.Thing and fw7.mods.Thing.ok == true and fw7.mods.Switched == nil)
local kept = io.open(MODS .. "/Palladium/mods.list", "r"):read("a")
check("and the file still reads exactly as the operator wrote it",
    kept == "; mine\nThing\n", kept)

if failures > 0 then
    io.write(failures, " check(s) failed\n")
    os.exit(1)
end
io.write("all checks passed\n")
