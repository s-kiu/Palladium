-- Encoding only, and never a reason the server heard nothing. Every value
-- here arrives from the engine through a loader, and loaders differ: one
-- build hands a plain number where another hands userdata whose tostring
-- raises from C++. One such field used to cost the whole event — the error
-- this replaces was "emit npc.spawn failed: invalid value (userdata)", an
-- event dropped for the one field in it that would not spell itself.
--
-- The rules: nothing in here ever raises; a value that cannot be written
-- becomes a placeholder naming its type; numbers that JSON has no spelling
-- for (nan, the infinities) are written as strings rather than as bare words
-- no parser accepts.

local jsonlite = {}

local MAX_TEXT = 512

local ESCAPES = {
    ['"'] = '\\"', ["\\"] = "\\\\", ["\b"] = "\\b", ["\f"] = "\\f",
    ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t",
}

-- What this value calls itself, asked politely. tostring first — it is what
-- every plain value answers — then the engine's own ToString for userdata
-- whose tostring metamethod refuses, then an honest placeholder.
local function safe_text(value)
    local ok, text = pcall(tostring, value)
    if ok and type(text) == "string" then return text end
    local ok_engine, engine = pcall(function() return value:ToString() end)
    if ok_engine and type(engine) == "string" then return engine end
    return "<" .. type(value) .. ">"
end

function jsonlite.string(value, limit)
    local text = value == nil and "" or safe_text(value)
    if #text > (limit or MAX_TEXT) then
        text = text:sub(1, limit or MAX_TEXT)
    end
    text = text:gsub('[%c"\\]', function(c)
        return ESCAPES[c] or string.format("\\u%04x", c:byte())
    end)
    return '"' .. text .. '"'
end

-- Values in data pairs: strings, numbers, booleans, or {raw=<json>} for a
-- pre-encoded object (a nested subject).
function jsonlite.value(value)
    local kind = type(value)
    if kind == "boolean" then return value and "true" or "false" end
    if kind == "number" then
        if value ~= value then return '"nan"' end
        if value == math.huge then return '"inf"' end
        if value == -math.huge then return '"-inf"' end
        if value % 1 == 0 then return string.format("%d", value) end
        return string.format("%.6g", value)
    end
    if kind == "table" and value.raw then return value.raw end
    return jsonlite.string(value)
end

function jsonlite.pairs(fields)
    local parts = {}
    for _, field in ipairs(fields or {}) do
        if field[2] ~= nil then
            parts[#parts + 1] = jsonlite.string(field[1], 32) .. ":" .. jsonlite.value(field[2])
        end
    end
    return table.concat(parts, ",")
end

return jsonlite
