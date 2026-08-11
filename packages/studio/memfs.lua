-- An in-memory stand-in for the handful of io/os calls the engine files make.
-- The studio runs Palladium's real store, collections and permissions code in
-- the browser, where there is no filesystem — so one is provided, backed by a
-- table. Only what those files actually touch is implemented; anything else
-- staying absent is a feature, because a new dependency in the engine should
-- fail loudly here rather than quietly diverge.
--
-- Also owns the clock: chat commands carry a per-player cooldown, and a
-- simulator that asks two questions in one second must not have the second
-- one silently swallowed. skip() moves time forward instead of waiting.

-- fengari-web ships no io library at all — a browser has nothing for it to
-- wrap — and only the portable slice of os. Both tables are created here when
-- missing; everything the engine touches is installed below either way.
io = io or {}
os = os or {}

local files = {}
local skew = 0

local real_time = os.time or function() error("no clock in this runtime") end
local real_date = os.date or function() return "" end

-- Global on purpose: boot.lua runs as a separate chunk in both hosts — dofile
-- under Lua 5.4 in the tests, a fengari dostring in the browser — and a
-- global is the one handover that works identically in both.
MEMFS = {}
local MEMFS = MEMFS

function MEMFS.wipe()
    files = {}
end

function MEMFS.write(path, text)
    files[path] = text
end

function MEMFS.read(path)
    return files[path]
end

function MEMFS.remove(path)
    files[path] = nil
end

function MEMFS.list()
    local out = {}
    for path in pairs(files) do out[#out + 1] = path end
    table.sort(out)
    return out
end

function MEMFS.skip(seconds)
    skew = skew + (tonumber(seconds) or 0)
end

local function new_handle(path, mode)
    local handle = {
        path = path,
        pos = 1,
        buffer = (mode == "a" and files[path]) or "",
        closed = false,
        mode = mode,
    }

    function handle:read(what)
        if self.mode ~= "r" then return nil end
        local text = files[self.path] or ""
        what = tostring(what or "l"):gsub("^%*", "")
        if what == "a" then
            local rest = text:sub(self.pos)
            self.pos = #text + 1
            return rest
        end
        -- One line, newline dropped — all the engine ever asks beyond "a".
        if self.pos > #text then return nil end
        local stop = text:find("\n", self.pos, true)
        local line
        if stop then
            line = text:sub(self.pos, stop - 1)
            self.pos = stop + 1
        else
            line = text:sub(self.pos)
            self.pos = #text + 1
        end
        return line
    end

    function handle:lines()
        return function() return self:read("l") end
    end

    function handle:write(...)
        for _, piece in ipairs({ ... }) do
            self.buffer = self.buffer .. tostring(piece)
        end
        files[self.path] = self.buffer
        return self
    end

    function handle:seek(whence, offset)
        local text = (self.mode == "r") and (files[self.path] or "") or self.buffer
        whence = whence or "cur"
        offset = offset or 0
        if whence == "end" then
            self.pos = #text + 1 + offset
        elseif whence == "set" then
            self.pos = offset + 1
        else
            self.pos = self.pos + offset
        end
        return self.pos - 1
    end

    function handle:close()
        self.closed = true
        return true
    end

    return handle
end

function MEMFS.install()
    io.open = function(path, mode)
        path = tostring(path)
        mode = tostring(mode or "r"):sub(1, 1)
        if mode == "r" then
            if files[path] == nil then return nil, path .. ": no such file" end
            return new_handle(path, "r")
        end
        if mode == "w" then
            files[path] = ""
            return new_handle(path, "w")
        end
        if mode == "a" then
            files[path] = files[path] or ""
            return new_handle(path, "a")
        end
        return nil, "unsupported mode " .. mode
    end

    -- Mods are loaded with loadfile(path, "t", sandbox) — served from the
    -- table like everything else, with the same chunk name a server would
    -- show in its errors.
    loadfile = function(path, mode, env)
        path = tostring(path)
        local text = files[path]
        if text == nil then
            return nil, path .. ": no such file"
        end
        return load(text, "@" .. path, mode or "t", env)
    end

    io.lines = function(path)
        local handle, err = io.open(path, "r")
        if not handle then error(err, 2) end
        return function()
            local line = handle:read("l")
            if line == nil then handle:close() end
            return line
        end
    end

    -- The engine only shells out to make directories; in here every directory
    -- already exists, and the guards in store.lua handle the rest.
    io.popen = nil
    os.execute = nil

    os.remove = function(path)
        files[tostring(path)] = nil
        return true
    end

    os.rename = function(old, new)
        old, new = tostring(old), tostring(new)
        if files[old] == nil then return nil, old .. ": no such file" end
        if old ~= new then
            files[new] = files[old]
            files[old] = nil
        end
        return true
    end

    os.getenv = function() return nil end

    os.time = function(spec)
        if spec then return real_time(spec) end
        return real_time() + skew
    end

    os.date = function(format, when)
        return real_date(format, when or (real_time() + skew))
    end
end

return MEMFS
