-- Palladium's own persistence. Tags, the player registry and the whole
-- permission system live here, because a mod running inside the game cannot
-- reach a database outside it.
--
-- The format is the one this runtime can already parse: tab-separated
-- key=value, one record per line, the same shape as the action queue. There is
-- no JSON parser in UE4SS Lua, and a format with no structure has nothing to
-- exploit.
--
--   tag	id=F8EA…:welcomekit.claimed	value=1786019899
--   player	id=F8EA…	name=Ashen	first=1785941621	joins=7
--   node	id=goldstreak.reward	mod=goldstreak	default=allow
--
-- Appends are the only writes on the hot path: a record changes by adding a
-- line, and the last line for an id wins. The file is rewritten from memory
-- when the dead weight outgrows the live records, through a temp file and a
-- rename, so a crash mid-compaction leaves the previous file intact.
--
-- Everything is held in memory as well, so a read never touches the disk. This
-- is a few thousand small records at most: a busy server's whole registry is
-- smaller than one save file.

local store = {}
store.__index = store

local DELETED = "\1deleted"
local COMPACT_MIN = 200   -- never compact a file this small
local COMPACT_RATIO = 2   -- … or until dead lines outnumber live ones this far

-- Tabs and newlines are the record separators, so they cannot appear in a
-- value. `=` can: fields split on the first one.
local function clean(text)
    return (tostring(text or ""):gsub("[\t\r\n]", " "))
end

local function encode(kind, id, fields)
    local parts = { clean(kind), "id=" .. clean(id) }
    for key, value in pairs(fields or {}) do
        if key ~= "id" then
            parts[#parts + 1] = clean(key) .. "=" .. clean(value)
        end
    end
    return table.concat(parts, "\t")
end

local function decode(line)
    local kind, rest = line:match("^([^\t]+)\t(.*)$")
    if not kind then return nil end
    local fields = {}
    for chunk in rest:gmatch("[^\t]+") do
        local key, value = chunk:match("^([^=]+)=(.*)$")
        if key then fields[key] = value end
    end
    if not fields.id then return nil end
    return kind, fields.id, fields
end

-- Paths come from the environment, so they are quoted rather than trusted.
local function shell_quote(path)
    return "'" .. tostring(path):gsub("'", "'\\''") .. "'"
end

function store.ensure_dir(path)
    -- A directory that already exists needs no shell: os.execute forks, and
    -- a fork while the engine is mid-load can take the process down.
    local probe = io.open(path .. "/.", "r")
    if probe then
        probe:close()
        return true
    end
    if type(os.execute) ~= "function" then return false end
    return os.execute("mkdir -p " .. shell_quote(path) .. " 2>/dev/null") ~= nil
end

local function dirname(path)
    return path:match("^(.*)/[^/]*$") or "."
end

-- Renaming a path to itself succeeds when it is there and fails when it is
-- not — the only existence test plain Lua has for a directory.
function store.path_exists(path)
    return os.rename(path, path) == true
end

-- Where this mod lives, and therefore where its sibling mods live. Relative
-- paths are no use: the game's working directory is not the folder holding
-- Mods/, so a `Mods/<name>/mod.lua` probe misses every time. Lua knows the
-- path of the chunk that is running, which is the one thing always true here.
--
--   @/palworld/server/Mods/Palladium/Scripts/main.lua → /palworld/server/Mods
function store.mods_dir(source)
    local explicit = os.getenv("PALLADIUM_MODS_DIR")
    if explicit and explicit ~= "" then return explicit, "PALLADIUM_MODS_DIR" end
    local dir = tostring(source or ""):match("^@(.*)/[^/]+/Scripts/[^/]+$")
    if dir then return dir, "beside this mod" end
    return "Mods", "relative to the working directory"
end

-- Where everything durable goes. PAL_ROOT wins, so an operator can always say;
-- `shared` is where pal-up mounts its volume; otherwise a folder beside the
-- game binaries, so a server running nothing but this mod needs no
-- configuration to keep what its mods remember.
-- The folder mods were *dropped into*, when that is not the folder the loader
-- reads. pal-up syncs ./mods into the server tree, so a mod's own directory
-- there is a mirror rebuilt on every boot — writing a mod's config to it would
-- lose the config. pal-up says where the originals are; a standalone server
-- has no such split and sets nothing.
function store.mods_source()
    local source = os.getenv("PALLADIUM_MODS_SOURCE")
    if source and source ~= "" and store.path_exists(source) then return source end
    return nil
end

function store.resolve_root(shared)
    shared = shared or "/palworld"
    local explicit = os.getenv("PAL_ROOT")
    if explicit and explicit ~= "" then return explicit, "PAL_ROOT" end
    if store.path_exists(shared) then return shared, "the pal-up data volume" end
    return "palladium", "beside the server — " .. shared .. " is not here"
end

function store.open(path, on_error)
    local self = setmetatable({
        path = path,
        data = {},      -- kind → id → fields
        counts = {},    -- kind → live record count
        lines = 0,      -- lines in the file, live or not
        live = 0,       -- records currently held
        failed = nil,   -- why writing is not working, if it is not
        on_error = on_error or function() end,
    }, store)

    store.ensure_dir(dirname(path))
    self:load()

    -- Probed at open rather than at the first write. A store that cannot
    -- persist still answers every read from memory, so without this the server
    -- runs a whole session looking correct and loses all of it on restart.
    local probe = io.open(path, "a")
    if probe then
        probe:close()
    else
        self:fail("cannot write " .. path)
    end
    return self
end

function store:fail(message)
    self.failed = message
    self.on_error(message)
end

function store:load()
    self.data, self.counts, self.lines, self.live = {}, {}, 0, 0
    local file = io.open(self.path, "r")
    if not file then return self end
    local body = file:read("a") or ""
    file:close()

    -- A record counts only once its newline reached the disk. A crash
    -- mid-append leaves a fragment which would otherwise parse as a record
    -- with fields missing — quietly losing the ones that never got written —
    -- so only newline-terminated lines are read at all. This pattern matches
    -- nothing else, which is what drops the fragment.
    local torn = body ~= "" and body:sub(-1) ~= "\n"
    for line in body:gmatch("([^\n]*)\n") do
        self.lines = self.lines + 1
        if line ~= "" then
            local kind, id, fields = decode(line)
            if kind then
                local bucket = self.data[kind]
                if not bucket then
                    bucket = {}
                    self.data[kind] = bucket
                    self.counts[kind] = 0
                end
                local existed = bucket[id] ~= nil
                if fields.value == DELETED or fields[DELETED] then
                    if existed then
                        bucket[id] = nil
                        self.counts[kind] = self.counts[kind] - 1
                        self.live = self.live - 1
                    end
                else
                    bucket[id] = fields
                    if not existed then
                        self.counts[kind] = self.counts[kind] + 1
                        self.live = self.live + 1
                    end
                end
            end
        end
    end

    -- The fragment is still on disk, and the next append would run straight
    -- into it and produce one unreadable line out of two records. Rewriting
    -- now, from what was just loaded, is the only way to be rid of it.
    if torn then self:compact() end
    return self
end

function store:append(line)
    local file, err = io.open(self.path, "a")
    if not file then
        self:fail(tostring(err))
        return false
    end
    file:write(line, "\n")
    file:close()
    self.lines = self.lines + 1
    self.failed = nil
    return true
end

function store:put(kind, id, fields)
    if id == nil or id == "" then return false end
    local record = {}
    for key, value in pairs(fields or {}) do record[key] = clean(value) end
    record.id = clean(id)

    local bucket = self.data[kind]
    if not bucket then
        bucket = {}
        self.data[kind] = bucket
        self.counts[kind] = 0
    end
    if bucket[record.id] == nil then
        self.counts[kind] = self.counts[kind] + 1
        self.live = self.live + 1
    end
    bucket[record.id] = record

    local ok = self:append(encode(kind, record.id, record))
    self:maybe_compact()
    return ok
end

function store:delete(kind, id)
    local bucket = self.data[kind]
    if not bucket or bucket[clean(id)] == nil then return false end
    bucket[clean(id)] = nil
    self.counts[kind] = self.counts[kind] - 1
    self.live = self.live - 1
    self:append(encode(kind, id, { value = DELETED }))
    self:maybe_compact()
    return true
end

function store:get(kind, id)
    local bucket = self.data[kind]
    return bucket and bucket[clean(id)] or nil
end

function store:all(kind)
    return self.data[kind] or {}
end

function store:count(kind)
    return self.counts[kind] or 0
end

function store:maybe_compact()
    if self.lines < COMPACT_MIN then return false end
    if self.lines < math.max(self.live, 1) * COMPACT_RATIO then return false end
    return self:compact()
end

-- Rewrite from memory. The temp file is fully written and closed before the
-- rename, so the store on disk is either entirely the old file or entirely the
-- new one — never a half-written mixture.
function store:compact()
    local temp = self.path .. ".tmp"
    local file, err = io.open(temp, "w")
    if not file then
        self:fail(tostring(err))
        return false
    end
    local written = 0
    for kind, bucket in pairs(self.data) do
        for id, fields in pairs(bucket) do
            file:write(encode(kind, id, fields), "\n")
            written = written + 1
        end
    end
    file:close()
    os.remove(self.path)
    local ok, rename_err = os.rename(temp, self.path)
    if not ok then
        self:fail(tostring(rename_err))
        return false
    end
    self.lines = written
    self.failed = nil
    return true
end

return store
