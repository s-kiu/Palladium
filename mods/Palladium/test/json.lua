-- The JSON layer, poked with everything a loader has ever handed it: plain
-- values, engine userdata that spells itself, userdata whose tostring raises
-- from C++, and numbers JSON has no words for. The one rule under test is
-- that nothing here ever raises — a field that cannot be written costs that
-- field, never the event around it.

local SCRIPTS = assert(os.getenv("PALLADIUM_SCRIPTS"), "PALLADIUM_SCRIPTS is not set")
package.path = SCRIPTS .. "/?.lua;" .. package.path
local J = require("jsonlite")

local failures = 0
local function check(name, condition, detail)
    if condition then
        io.write("  ok   ", name, "\n")
    else
        failures = failures + 1
        io.write("  FAIL ", name, "\n       ", tostring(detail), "\n")
    end
end

check("a plain string is quoted and escaped",
    J.string('say "hi"\n') == '"say \\"hi\\"\\n"', J.string('say "hi"\n'))
check("a long value is cut at the limit",
    J.string(string.rep("a", 600), 16) == '"' .. string.rep("a", 16) .. '"')
check("integers print as integers, floats as floats",
    J.value(42) == "42" and J.value(1.5) == "1.5", J.value(42) .. " " .. J.value(1.5))
check("booleans are words", J.value(true) == "true" and J.value(false) == "false")
check("a pre-encoded object passes through raw",
    J.value({ raw = '{"x":1}' }) == '{"x":1}')

-- Numbers JSON cannot spell: bare nan/inf would poison the whole line for
-- every parser downstream.
check("nan is written as a string", J.value(0 / 0) == '"nan"')
check("the infinities are written as strings",
    J.value(math.huge) == '"inf"' and J.value(-math.huge) == '"-inf"')

-- Real userdata whose tostring works: a file handle.
local handle = io.open(SCRIPTS .. "/jsonlite.lua", "r")
local encoded_handle = J.value(handle)
handle:close()
check("userdata that can spell itself is encoded as its text",
    encoded_handle:match('^"file') ~= nil, encoded_handle)

-- The reported crash: a value whose tostring raises from the loader's C++.
local poison = setmetatable({}, { __tostring = function()
    error("invalid value (userdata)")
end })
local ok, out = pcall(J.value, poison)
check("a value whose tostring raises does not raise here", ok, out)
check("and becomes a placeholder naming its type", ok and out == '"<table>"', out)

-- A loader object that refuses tostring but answers the engine's ToString.
local engineish = setmetatable({ ToString = function() return "FlameBird" end },
    { __tostring = function() error("no") end })
check("the engine's own ToString is asked before giving up",
    J.value(engineish) == '"FlameBird"', J.value(engineish))

-- The event around a poisoned field survives with every other field intact.
local line = J.pairs({ { "species", poison }, { "level", 50 }, { "rare", false } })
check("one poisoned field costs the field, not the event",
    line == '"species":"<table>","level":50,"rare":false', line)

if failures > 0 then
    io.write(failures, " check(s) failed\n")
    os.exit(1)
end
io.write("all checks passed\n")
