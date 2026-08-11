-- Declared collections: the one way anything is stored.
--
-- A collection is a named set of records with an owner, a shape and a storage
-- class. Declaring it is what makes it discoverable — the panel can list and
-- edit a collection it has never heard of, because the declaration says what
-- the records look like.
--
--   collections.declare("shop", "listings", {
--       description = "items players have put up for sale",
--       fields = { seller = "player", item = "item_id", price = "int" },
--       storage = "data",
--   })
--
--   local listings = collections.open("shop.listings")
--   listings:set(id, { seller = who, item = "PalSphere", price = 500 })
--
-- Two storage classes, because one file cannot do both jobs:
--
--   data    thousands of records nobody hand-edits — kept in the append log,
--           indexed in memory, edited through the panel or a capability.
--   config  a handful an operator owns — kept in an INI file, rewritten when
--           anything changes it, re-read when they change it themselves.
--
-- A mod author picks the class once in the declaration and then uses the same
-- handle either way.

local collections = {}

local host = {
    store = nil,          -- the append log, for storage = "data"
    root = ".",           -- config files live under <root>/palladium/
    info = function() end,
}

local declared = {}       -- qualified name → spec
local files = {}          -- file name → { path, text, records, problems }
local homes = {}          -- owner → the directory that owner's files live in
local stores = {}         -- owner → its own append log

local NAME_RE = "^[a-z][a-z0-9_]*$"

local function log(text)
    host.info("collections: " .. text)
end

-- Every owner keeps its files in its own folder, so a mod carries its config
-- and its records with it and deleting the folder is a clean uninstall.
function collections.home(owner, dir)
    homes[tostring(owner):lower()] = dir
end

local function home_of(owner)
    return homes[owner] or (host.root .. "/palladium")
end

-- Whether this owner has a folder of its own, as against the shared fallback.
-- Callers that file something per mod need to know the difference: writing to
-- the fallback is how two owners end up sharing one file without either
-- meaning to.
function collections.has_home(owner)
    return homes[tostring(owner):lower()] ~= nil
end

-- `.data`, not `<owner>.data`: the folder already says whose it is, and a name
-- repeated in its own path is a name that can disagree with it.
local function store_for(owner)
    if not stores[owner] then
        local Store = require("store")
        Store.ensure_dir(home_of(owner))
        stores[owner] = Store.open(home_of(owner) .. "/.data", function(message)
            log(owner .. " cannot persist: " .. message)
        end)
    end
    return stores[owner]
end

-- ── the INI file behind config collections ──────────────────────────────────
-- Sections are `[<collection> <id>]`, or a single `[<collection>]` block of
-- `id = value` lines when the spec asks for the flat layout — which is what
-- makes a list of a hundred permission nodes readable rather than a hundred
-- sections.

-- Everything before the first section header. A mod's settings live there, in
-- the same file as its nodes, so one folder holds one config — which means
-- render has to put those lines back rather than treating the file as its own.
local function preamble_of(text)
    local out = {}
    for line in (tostring(text or "") .. "\n"):gmatch("([^\n]*)\n") do
        if line:match("^%s*%[") then break end
        out[#out + 1] = line
    end

    -- Whatever render writes for itself is not part of what it must carry
    -- through: the banner, and the blank lines around it. Kept, they would
    -- stack another copy on every single rewrite.
    while out[1] and (out[1]:match("^%s*$")
        or out[1]:match("^;%s*Palladium —")
        or out[1]:match("^;%s*Edit by hand")
        or out[1]:match("^;%s*Rewritten whenever")) do
        table.remove(out, 1)
    end

    -- A comment sitting immediately above a section describes that section —
    -- render emits it from the collection's own description — so it belongs to
    -- what follows, not to what came before.
    while out[#out] and (out[#out]:match("^%s*$") or out[#out]:match("^%s*;")) do
        table.remove(out)
    end
    return table.concat(out, "\n")
end

local function parse_ini(text)
    local sections = {}   -- { header, line, fields, comments, lines }
    local unparsed = {}   -- lines that are neither blank, comment, header nor pair
    local current = nil
    local number = 0
    for line in (text or ""):gmatch("([^\n]*)\n?") do
        number = number + 1
        local stripped = line:gsub("^%s+", ""):gsub("%s+$", "")
        if stripped == "" or stripped:sub(1, 1) == ";" or stripped:sub(1, 1) == "#" then
            -- comment or blank
        else
            local header = stripped:match("^%[(.-)%]$")
            if header then
                current = { header = header, line = number, fields = {}, comments = {}, lines = {} }
                sections[#sections + 1] = current
            else
                local key, value = stripped:match("^([^=]-)%s*=%s*(.*)$")
                if not key or key == "" then
                    unparsed[#unparsed + 1] = { line = number, text = stripped }
                elseif not current then
                    unparsed[#unparsed + 1] = { line = number, text = stripped .. " (before any section)" }
                else
                    -- The trailing comment is kept, not discarded: in the flat
                    -- layout it carries the description, and dropping it would
                    -- empty every description the moment somebody hand-edits.
                    local note = value:match("%s*;%s*(.*)$")
                    if note then current.comments[key] = note end
                    value = value:gsub("%s*;.*$", "")
                    current.lines[key] = current.lines[key] or number
                    local existing = current.fields[key]
                    if existing == nil then
                        current.fields[key] = value
                    elseif type(existing) == "table" then
                        existing[#existing + 1] = value
                    else
                        current.fields[key] = { existing, value }
                    end
                end
            end
        end
    end
    return sections, unparsed
end

local function as_list(value)
    if value == nil then return {} end
    if type(value) == "table" then return value end
    if value == "" then return {} end
    return { value }
end

local function sorted_keys(map)
    local keys = {}
    for key in pairs(map) do keys[#keys + 1] = key end
    table.sort(keys)
    return keys
end

-- A file is identified by owner and basename: `bridge/permissions` is
-- Palladium's permissions.config, `goldstreak/goldstreak` is that mod's own.
local function key_of(spec)
    return spec.owner .. "/" .. spec.file
end

local function owner_of_key(key)
    return key:match("^([^/]+)/")
end

-- Records for one file, grouped by collection, rendered in a stable order so
-- an unchanged state produces a byte-identical file.
local function render(key)
    local file_name = key:match("/(.+)$")
    local out = {
        "; Palladium — " .. file_name .. ".config",
        "; Edit by hand, from the panel, or from a mod; all three end up here.",
        "; Rewritten whenever anything changes it, so comments do not survive.",
        "",
    }
    -- Lines this file's collections do not own — a mod's settings — are copied
    -- through untouched. Losing them on the next node change would be losing
    -- the operator's tuning.
    local kept = files[key] and files[key].preamble
    if kept and kept:gsub("%s", "") ~= "" then
        out[#out + 1] = (kept:gsub("^%s*\n", ""):gsub("%s+$", ""))
        out[#out + 1] = ""
    end
    for _, qualified in ipairs(sorted_keys(declared)) do
        local spec = declared[qualified]
        if spec.storage == "config" and key_of(spec) == key then
            local records = files[key].records[qualified] or {}
            local ids = sorted_keys(records)
            if spec.description then out[#out + 1] = "; " .. spec.description end

            if spec.layout == "flat" then
                out[#out + 1] = "[" .. spec.name .. "]"
                for _, id in ipairs(ids) do
                    local record = records[id]
                    local value = tostring(record[spec.value_field] or "")
                    local note = spec.comment_field and record[spec.comment_field]
                    out[#out + 1] = string.format("%s = %s%s", id, value,
                        (note and note ~= "") and ("    ; " .. note) or "")
                end
                out[#out + 1] = ""
            else
                for _, id in ipairs(ids) do
                    out[#out + 1] = "[" .. spec.name .. " " .. id .. "]"
                    for _, key in ipairs(sorted_keys(records[id])) do
                        local value = records[id][key]
                        if type(value) == "table" then
                            for _, item in ipairs(value) do
                                out[#out + 1] = key .. " = " .. tostring(item)
                            end
                        elseif value ~= nil and value ~= "" then
                            out[#out + 1] = key .. " = " .. tostring(value)
                        end
                    end
                    out[#out + 1] = ""
                end
            end
        end
    end
    return table.concat(out, "\n")
end

-- One file can be pinned somewhere other than its owner's folder. The groups
-- and grants Palladium keeps span every mod, so their file sits beside the mod
-- folders rather than inside the one that happens to own the collection.
local pins = {}

function collections.pin(key, dir)
    pins[key] = dir
end

local function file_for(key)
    local file = files[key]
    if not file then
        local owner, base = key:match("^([^/]+)/(.+)$")
        file = {
            path = (pins[key] or home_of(owner)) .. "/" .. base .. ".config",
            text = nil, records = {}, problems = {},
        }
        files[key] = file
    end
    return file
end

local function read_file(key)
    local file = file_for(key)
    local handle = io.open(file.path, "r")
    if not handle then return nil end
    local text = handle:read("a")
    handle:close()
    return text
end

-- Parse a file's text into records, and say what could not be made sense of.
--
-- Silence is the wrong answer for a file people edit by hand: a mistyped
-- section or field simply would not apply, with nothing anywhere to explain
-- why. Nothing here is fatal — what parses is loaded, the rest is reported —
-- because one bad line must never cost somebody their whole permissions file.

local function near_miss(word, candidates)
    -- A typo is almost always a near-miss, so name the closest thing rather
    -- than only saying "unknown".
    local best, best_score = nil, 0
    for candidate in pairs(candidates) do
        local score = 0
        for i = 1, math.min(#word, #candidate) do
            if word:sub(i, i) == candidate:sub(i, i) then score = score + 1 end
        end
        if score > best_score then best, best_score = candidate, score end
    end
    if best and best_score >= math.max(2, math.floor(#best / 2)) then return best end
    return nil
end

local function type_problem(kind, value)
    if kind == "int" or kind == "number" then
        if tonumber(value) == nil then return "is not a " .. kind end
    elseif kind == "bool" then
        if value ~= "true" and value ~= "false" then return "must be true or false" end
    end
    return nil
end

local function absorb(key, text)
    local file = file_for(key)
    file.records = {}
    file.problems = {}
    file.preamble = preamble_of(text)

    -- Whether anything sharing this file owns the lines above the first
    -- section. When something does, they are data rather than a mistake.
    local shared = false
    for _, spec in pairs(declared) do
        if spec.storage == "config" and key_of(spec) == key and spec.preamble then shared = true end
    end
    local function problem(line, message)
        file.problems[#file.problems + 1] = { line = line, message = message }
    end

    local by_section = {}
    for _, spec in pairs(declared) do
        if spec.storage == "config" and key_of(spec) == key then
            by_section[spec.name] = spec
        end
    end

    local sections, unparsed = parse_ini(text)
    for _, bad in ipairs(unparsed) do
        if not (shared and bad.text:find("(before any section)", 1, true)) then
            problem(bad.line, string.format("not `key = value`: %s", bad.text))
        end
    end

    for _, section in ipairs(sections) do
        local head, id = section.header:match("^(%S+)%s+(.+)$")
        local spec = by_section[head or section.header]
        if not spec then
            local wanted = head or section.header
            local closest = near_miss(wanted, by_section)
            problem(section.line, string.format("no collection %s in this file%s",
                wanted, closest and (" — did you mean " .. closest .. "?") or ""))
        else
            local qualified = spec.owner .. "." .. spec.name
            file.records[qualified] = file.records[qualified] or {}
            if spec.layout == "flat" then
                for field, value in pairs(section.fields) do
                    if type(value) ~= "table" then
                        local record = { [spec.value_field] = value }
                        if spec.comment_field then
                            record[spec.comment_field] = section.comments[field] or ""
                        end
                        file.records[qualified][field] = record
                    end
                end
            elseif id then
                for field, value in pairs(section.fields) do
                    local kind = spec.fields and spec.fields[field]
                    if spec.fields and next(spec.fields) ~= nil and kind == nil then
                        local closest = near_miss(field, spec.fields)
                        problem(section.lines and section.lines[field],
                            string.format("%s is not a field of %s%s", field, spec.name,
                                closest and (" — did you mean " .. closest .. "?") or ""))
                    elseif kind and type(value) ~= "table" then
                        local wrong = type_problem(kind, value)
                        if wrong then
                            problem(section.lines and section.lines[field],
                                string.format("%s = %s %s", field, value, wrong))
                        end
                    end
                end
                file.records[qualified][id] = section.fields
            else
                problem(section.line, string.format("[%s] needs a name: [%s <id>]",
                    section.header, spec.name))
            end
        end
    end
    file.text = text
end

local function save(key)
    local file = file_for(key)
    local text = render(key)
    if text == file.text then return true end

    local Store = require("store")
    Store.ensure_dir(pins[key] or home_of(owner_of_key(key)))
    local handle, err = io.open(file.path .. ".tmp", "w")
    if not handle then
        log("cannot write " .. file.path .. ": " .. tostring(err))
        return false
    end
    handle:write(text)
    handle:close()
    os.remove(file.path)
    if not os.rename(file.path .. ".tmp", file.path) then
        log("cannot replace " .. file.path)
        return false
    end
    file.text = text
    return true
end

-- An operator editing the file by hand is the point of it existing, so the
-- text on disk is compared with what was last written and re-absorbed when it
-- differs. Cheap: these files are small by construction.
function collections.reload_changed()
    local changed = {}
    for key, file in pairs(files) do
        local text = read_file(key)
        if text and text ~= file.text then
            absorb(key, text)
            changed[#changed + 1] = key
            log(key .. ".config changed on disk — reloaded")
            for _, p in ipairs(file.problems) do
                log(string.format("%s.config line %s: %s", key, tostring(p.line or "?"), p.message))
            end
        end
    end
    return changed
end

-- Everything wrong with the config files, by owner, for the log and the panel.
function collections.problems(owner)
    local out = {}
    for key, file in pairs(files) do
        if not owner or owner_of_key(key) == owner then
            local base = key:match("/(.+)$")
            for _, p in ipairs(file.problems or {}) do
                out[#out + 1] = string.format("%s.config line %s: %s",
                    base, tostring(p.line or "?"), p.message)
            end
        end
    end
    table.sort(out)
    return out
end

-- ── handles ─────────────────────────────────────────────────────────────────

local handle = {}
handle.__index = handle

function handle:get(id)
    if self.spec.storage == "config" then
        local records = file_for(key_of(self.spec)).records[self.qualified]
        return records and records[tostring(id)] or nil
    end
    return store_for(self.spec.owner):get(self.qualified, id)
end

function handle:all()
    if self.spec.storage == "config" then
        return file_for(key_of(self.spec)).records[self.qualified] or {}
    end
    return store_for(self.spec.owner):all(self.qualified)
end

function handle:count()
    local n = 0
    for _ in pairs(self:all()) do n = n + 1 end
    return n
end

function handle:set(id, fields)
    id = tostring(id)
    if id == "" then return false end
    if self.spec.storage == "config" then
        local file = file_for(key_of(self.spec))
        file.records[self.qualified] = file.records[self.qualified] or {}
        file.records[self.qualified][id] = fields
        return save(key_of(self.spec))
    end
    return store_for(self.spec.owner):put(self.qualified, id, fields)
end

function handle:delete(id)
    id = tostring(id)
    if self.spec.storage == "config" then
        local file = file_for(key_of(self.spec))
        local records = file.records[self.qualified]
        if not records or records[id] == nil then return false end
        records[id] = nil
        return save(key_of(self.spec))
    end
    return store_for(self.spec.owner):delete(self.qualified, id)
end

-- Lists are how a config record holds more than one of something — the nodes a
-- group allows, the groups a player is in. Reading one always answers a table,
-- whether the file had no line, one line or many.
function handle:list(id, key)
    local record = self:get(id)
    return as_list(record and record[key])
end

-- ── declaration ─────────────────────────────────────────────────────────────

function collections.declare(owner, name, spec)
    owner, name = tostring(owner):lower(), tostring(name):lower()
    if not owner:match(NAME_RE) then return nil, "bad owner: " .. owner end
    if not name:match(NAME_RE) then return nil, "bad collection name: " .. name end

    local qualified = owner .. "." .. name
    local storage = spec.storage == "config" and "config" or "data"
    declared[qualified] = {
        owner = owner,
        name = name,
        qualified = qualified,
        description = spec.description,
        fields = spec.fields or {},
        storage = storage,
        file = spec.file or owner,
        layout = spec.layout == "flat" and "flat" or "sections",
        value_field = spec.value_field or "value",
        comment_field = spec.comment_field,
        key = spec.key or "string",
        -- Something else owns the lines above the first section in this file —
        -- a mod's settings sit there. They are copied through on a rewrite and
        -- never reported as unreadable.
        preamble = spec.preamble == true,
    }

    -- A config collection's file is its home, so it is read the moment the
    -- collection exists rather than at some later first use.
    if storage == "config" then
        local key = key_of(declared[qualified])
        local text = read_file(key)
        if text then absorb(key, text) end
    end
    return collections.open(qualified)
end

function collections.open(qualified)
    local spec = declared[qualified]
    if not spec then return nil end
    return setmetatable({ qualified = qualified, spec = spec }, handle)
end

function collections.spec(qualified)
    return declared[qualified]
end

-- Everything declared, for the registry snapshot and the panel's browser.
function collections.all()
    local out = {}
    for _, qualified in ipairs(sorted_keys(declared)) do
        local spec = declared[qualified]
        local count = 0
        for _ in pairs(collections.open(qualified):all()) do count = count + 1 end
        out[#out + 1] = {
            qualified = qualified,
            owner = spec.owner,
            name = spec.name,
            description = spec.description or "",
            storage = spec.storage,
            fields = spec.fields,
            file = spec.storage == "config" and (spec.file .. ".config") or nil,
            count = count,
        }
    end
    return out
end

function collections.init(options)
    for key, value in pairs(options or {}) do host[key] = value end
    return collections
end

-- Test seam: a fresh registry without reloading the module.
function collections.reset()
    declared, files, homes, stores, pins = {}, {}, {}, {}, {}
end

return collections
