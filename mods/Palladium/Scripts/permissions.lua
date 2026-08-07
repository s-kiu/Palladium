-- Who may do what, resolved in the game process and kept in a file an
-- operator can open.
--
-- The model and its resolution order are the ones the panel has always used:
--
--   1. the player's own overrides win outright,
--   2. then their groups, highest weight first,
--   3. then the default group everyone is in,
--   4. then the node's registered default — deny, if nobody registered it.
--
-- Within one source an exact node beats `kits.*` beats `*`, and deny wins ties.
--
-- All of it lives in three declared collections that share one config file, so
-- `permissions.config` is not an export of the real state — it *is* the real
-- state, and editing it by hand is a first-class way to change permissions.

local permissions = {}
permissions.__index = permissions

local FILE = "permissions"

-- An entry is a node with an optional constraint after it:
--
--   allow = goldstreak.*
--   allow = pal.spawn where species in SheepBall,Lamball
--   allow = pal.spawn where level <= 20 and rare = false
--   allow = player.teleport where x >= 0 and x <= 1000
--
-- The syntax is plain on purpose: this runtime has no JSON parser, and a
-- constraint nobody can read in the file is a constraint nobody will write.
-- Matching happens here, so the same answer comes back whether the question
-- arrives from a mod in this process or over HTTP.
local function split_entry(text)
    local node, where = tostring(text):match("^(%S+)%s*(.*)$")
    return node, (where ~= "" and where or nil)
end

-- `until 2026-09-01` or `until 2026-09-01T14:30` ends a grant: once the
-- stamp passes, the entry is simply not there anymore. A date alone means
-- midnight starting that day, server-local time. The stamp sits at the end
-- of an entry, after any constraint.
local function split_until(text)
    local head, stamp = tostring(text):match("^(.-)%s+until%s+(%S+)%s*$")
    if head then return head, stamp end
    return text, nil
end

local function expiry_epoch(stamp)
    if not stamp then return nil end
    local y, m, d, H, M = stamp:match("^(%d+)%-(%d+)%-(%d+)T(%d+):(%d+)$")
    if not y then
        y, m, d = stamp:match("^(%d+)%-(%d+)%-(%d+)$")
        H, M = 0, 0
    end
    if not y then return nil end
    return os.time({ year = tonumber(y), month = tonumber(m), day = tonumber(d),
                     hour = tonumber(H), min = tonumber(M) })
end

local function join_entry(node, where, until_stamp)
    local text = (where and where ~= "") and (node .. " " .. where) or node
    if until_stamp and until_stamp ~= "" then text = text .. " until " .. until_stamp end
    return text
end

local function without(list, node)
    local out = {}
    for _, text in ipairs(list) do
        if split_entry(text) ~= node then out[#out + 1] = text end
    end
    return out
end


-- ── constraints ─────────────────────────────────────────────────────────────
--
--   where <field> <op> <value> [and <field> <op> <value>]...
--
-- Operators: in (comma-separated), =, !=, <, <=, >, >=. A field the call did
-- not supply fails the condition — a grant narrowed to "only Lamball" must not
-- widen when the caller simply leaves the species out.

local OPS = { "<=", ">=", "!=", "<", ">", "=" }

local function condition(text)
    local field, rest = text:match("^(%S+)%s+in%s+(.+)$")
    if field then
        local allowed = {}
        for item in rest:gmatch("[^,%s]+") do allowed[item:lower()] = true end
        return { field = field, op = "in", set = allowed, shown = rest }
    end
    for _, op in ipairs(OPS) do
        local f, v = text:match("^(%S+)%s*" .. op:gsub("(.)", "%%%1") .. "%s*(.+)$")
        if f then return { field = f, op = op, value = v } end
    end
    return nil
end

-- → list of alternatives — each a list of conditions — or nil when there is
-- no constraint at all. `and` binds tighter than `or`: "a and b or c" is
-- (a and b) or (c).
function permissions.parse_where(where)
    if not where or where == "" then return nil end
    local body = where:match("^where%s+(.+)$")
    if not body then return nil end
    local alternatives = {}
    for clause in (body .. " or "):gmatch("(.-)%s+or%s+") do
        local conditions = {}
        for piece in (clause .. " and "):gmatch("(.-)%s+and%s+") do
            local parsed = condition(piece:gsub("^%s+", ""):gsub("%s+$", ""))
            if parsed then conditions[#conditions + 1] = parsed end
        end
        if #conditions > 0 then alternatives[#alternatives + 1] = conditions end
    end
    return #alternatives > 0 and alternatives or nil
end

-- → nil when the condition holds, or why it does not
local function condition_violation(c, params)
    local given = params[c.field]
    if given == nil then
        return string.format("%s is constrained and was not given", c.field)
    end
    local text = tostring(given):lower()
    if c.op == "in" then
        if not c.set[text] then
            return string.format("%s must be one of %s", c.field, c.shown)
        end
    elseif c.op == "=" then
        if text ~= tostring(c.value):lower() then
            return string.format("%s must be %s", c.field, c.value)
        end
    elseif c.op == "!=" then
        if text == tostring(c.value):lower() then
            return string.format("%s must not be %s", c.field, c.value)
        end
    else
        local left, right = tonumber(given), tonumber(c.value)
        if not left or not right then
            return string.format("%s is not a number", c.field)
        end
        local ok = (c.op == "<" and left < right) or (c.op == "<=" and left <= right)
            or (c.op == ">" and left > right) or (c.op == ">=" and left >= right)
        if not ok then
            return string.format("%s must be %s %s", c.field, c.op, c.value)
        end
    end
    return nil
end

-- → nil when any alternative matches in full, or why the first one did not
function permissions.violation(where, params)
    local alternatives = permissions.parse_where(where)
    if not alternatives then return nil end
    params = params or {}

    local first
    for _, conditions in ipairs(alternatives) do
        local failed
        for _, c in ipairs(conditions) do
            failed = condition_violation(c, params)
            if failed then break end
        end
        if not failed then return nil end
        first = first or failed
    end
    if #alternatives > 1 then
        return first .. " (and no other alternative matched)"
    end
    return first
end

function permissions.new(collections)
    local self = setmetatable({ collections = collections }, permissions)

    self.nodes_c = collections.declare("bridge", "nodes", {
        description = "every permission node the installed mods registered, and its default",
        storage = "config",
        file = FILE,
        layout = "flat",
        value_field = "default",
        comment_field = "description",
        fields = { default = "string" },
    })

    self.groups_c = collections.declare("bridge", "groups", {
        description = "groups: what they allow and deny, and which one everybody is in",
        storage = "config",
        file = FILE,
        key = "string",
        fields = { weight = "int", tag = "string", is_default = "bool", allow = "list", deny = "list" },
    })

    self.players_c = collections.declare("bridge", "players", {
        description = "per-player group membership and overrides, by 32-hex player id",
        storage = "config",
        file = FILE,
        key = "player",
        fields = { groups = "list", allow = "list", deny = "list" },
    })

    self:ensure_default_group()
    return self
end

function permissions:ensure_default_group()
    for _, record in pairs(self.groups_c:all()) do
        if record.is_default == "true" then return end
    end
    self.groups_c:set("default", { weight = "0", is_default = "true" })
end

-- ── registration ────────────────────────────────────────────────────────────
-- A mod's nodes are written on every load. That is what fills the file in:
-- install a mod, restart, and everything it can gate is listed with the
-- default it asked for, ready to be changed.

function permissions:register(mod, nodes)
    local count = 0
    for _, entry in ipairs(nodes or {}) do
        if type(entry) == "table" and type(entry.node) == "string" then
            local node = entry.node:lower()
            local existing = self.nodes_c:get(node)
            -- An operator's change to a default outranks the mod's opinion of
            -- it: re-registering must not silently undo the file.
            self.nodes_c:set(node, {
                default = existing and existing.default
                    or (entry.default == "allow" and "allow" or "deny"),
                description = entry.description or (existing and existing.description) or "",
            })
            count = count + 1
        end
    end
    return count
end

function permissions:nodes()
    return self.nodes_c:all()
end

-- The mod a node belongs to is its prefix — the rule that a mod may only
-- register under its own name is what makes that reliable, and it saves
-- carrying an owner column in the file.
function permissions.owner_of(node)
    return tostring(node):match("^([^.]+)%.") or ""
end

-- ── groups and grants ───────────────────────────────────────────────────────

function permissions:group_create(name, tag, weight)
    if self.groups_c:get(name) then return false, "exists" end
    self.groups_c:set(name, { weight = tostring(weight or 0), tag = tag or "", is_default = "false" })
    return true
end

function permissions:group_update(name, tag, weight)
    local record = self.groups_c:get(name)
    if not record then return false, "unknown_group" end
    record.tag = tag or record.tag
    record.weight = tostring(weight or record.weight or 0)
    self.groups_c:set(name, record)
    return true
end

function permissions:group_delete(name)
    local record = self.groups_c:get(name)
    if not record then return false, "unknown_group" end
    if record.is_default == "true" then return false, "cannot delete the default group" end
    for uid, player in pairs(self.players_c:all()) do
        local left = {}
        for _, group in ipairs(self.players_c:list(uid, "groups")) do
            if group ~= name then left[#left + 1] = group end
        end
        player.groups = left
        self.players_c:set(uid, player)
    end
    self.groups_c:delete(name)
    return true
end

function permissions:groups()
    return self.groups_c:all()
end

-- One node is in a group's allow list or its deny list, never both, so setting
-- an effect removes whatever the other list said about it.
function permissions:group_set_entry(group, node, effect, where, until_stamp)
    local record = self.groups_c:get(group)
    if not record then return false, "unknown_group" end
    if until_stamp and until_stamp ~= "" and not expiry_epoch(until_stamp) then
        return false, "invalid_until"
    end
    node = tostring(node):lower()
    record.allow = without(self.groups_c:list(group, "allow"), node)
    record.deny = without(self.groups_c:list(group, "deny"), node)
    local target = effect == "allow" and record.allow or record.deny
    target[#target + 1] = join_entry(node, where, until_stamp)
    self.groups_c:set(group, record)
    return true
end

function permissions:group_remove_entry(group, node)
    local record = self.groups_c:get(group)
    if not record then return false, "unknown_group" end
    node = tostring(node):lower()
    record.allow = without(self.groups_c:list(group, "allow"), node)
    record.deny = without(self.groups_c:list(group, "deny"), node)
    self.groups_c:set(group, record)
    return true
end

function permissions:assign(userid, group)
    if not self.groups_c:get(group) then return false, "unknown_group" end
    local record = self.players_c:get(userid) or {}
    local groups = self.players_c:list(userid, "groups")
    for _, name in ipairs(groups) do
        if name == group then return true end
    end
    groups[#groups + 1] = group
    record.groups = groups
    self.players_c:set(userid, record)
    return true
end

function permissions:unassign(userid, group)
    local record = self.players_c:get(userid)
    if not record then return false end
    local left = {}
    for _, name in ipairs(self.players_c:list(userid, "groups")) do
        if name ~= group then left[#left + 1] = name end
    end
    record.groups = left
    self.players_c:set(userid, record)
    return true
end

function permissions:grant(userid, node, effect, where, until_stamp)
    if until_stamp and until_stamp ~= "" and not expiry_epoch(until_stamp) then
        return false, "invalid_until"
    end
    local record = self.players_c:get(userid) or {}
    node = tostring(node):lower()
    record.allow = without(self.players_c:list(userid, "allow"), node)
    record.deny = without(self.players_c:list(userid, "deny"), node)
    local target = effect == "allow" and record.allow or record.deny
    target[#target + 1] = join_entry(node, where, until_stamp)
    self.players_c:set(userid, record)
    return true
end

function permissions:revoke(userid, node)
    local record = self.players_c:get(userid)
    if not record then return false end
    node = tostring(node):lower()
    record.allow = without(self.players_c:list(userid, "allow"), node)
    record.deny = without(self.players_c:list(userid, "deny"), node)
    self.players_c:set(userid, record)
    return true
end

-- ── resolution ──────────────────────────────────────────────────────────────

-- How specifically a pattern matches, or nil for no match. Exact beats a
-- wildcard, and a longer wildcard beats a shorter one.
local function specificity(pattern, node)
    if pattern == node then return 1000 end
    if pattern == "*" then return 0 end
    if pattern:sub(-2) == ".*" then
        local prefix = pattern:sub(1, -2) -- keep the dot
        if node:sub(1, #prefix) == prefix then
            local depth = 1
            for _ in pattern:gmatch("%.") do depth = depth + 1 end
            return depth
        end
    end
    return nil
end

local function entries_from(handle, id)
    local out = {}
    local now = os.time()
    for _, effect in ipairs({ "allow", "deny" }) do
        for _, text in ipairs(handle:list(id, effect)) do
            local body, stamp = split_until(text)
            local node, where = split_entry(body)
            local expires = expiry_epoch(stamp)
            -- An unparseable stamp keeps the entry dead rather than eternal.
            if stamp and not expires then node = nil end
            if node and (not expires or expires > now) then
                out[#out + 1] = { node = node, effect = effect, where = where }
            end
        end
    end
    return out
end

local function best_in(entries, node)
    local best = nil
    for _, entry in ipairs(entries) do
        local spec = specificity(entry.node, node)
        if spec ~= nil then
            if best == nil or spec > best.spec or (spec == best.spec and entry.effect == "deny") then
                best = { spec = spec, effect = entry.effect, where = entry.where }
            end
        end
    end
    return best
end

function permissions:entries_of(group)
    return entries_from(self.groups_c, group)
end

function permissions:user_entries(userid)
    return entries_from(self.players_c, userid)
end

function permissions:groups_of(userid)
    local names = {}
    for _, group in ipairs(self.players_c:list(userid, "groups")) do
        local record = self.groups_c:get(group)
        if record then names[#names + 1] = { name = group, weight = tonumber(record.weight) or 0 } end
    end
    table.sort(names, function(a, b)
        if a.weight ~= b.weight then return a.weight > b.weight end
        return a.name < b.name
    end)
    return names
end

function permissions:default_group()
    for name, record in pairs(self.groups_c:all()) do
        if record.is_default == "true" then return name end
    end
    return nil
end

-- A player's standing: the name and weight of their highest-weight group,
-- falling back to the default group everybody is in. This is what a
-- target_group / target_weight constraint is measured against.
function permissions:standing(userid)
    local groups = self:groups_of(userid)
    if groups[1] then return groups[1].name, groups[1].weight end
    local fallback = self:default_group()
    if fallback then
        local record = self.groups_c:get(fallback)
        return fallback, tonumber(record and record.weight) or 0
    end
    return "none", 0
end

-- → allowed, source, where, violation
--
-- `params` are the parameters of the call being asked about. A grant carrying
-- a constraint only applies when they satisfy it; without them, a constrained
-- grant cannot be relied on and the answer is no.
--
-- Standing is derived here, not by the caller, so a constraint written once
-- holds on every surface — chat, a mod's pal.can, a permission.check over
-- HTTP. When the call names a target, target_group / target_weight are the
-- target's highest-weight group and its weight; the caller themselves weighs
-- -1, beneath every rank, so nobody's own commands go dark. When the call
-- names a group, group_weight is that group's weight — which is how a grant
-- of group.assign is kept below the granter's own rank.
function permissions:resolve(userid, node, params)
    node = tostring(node or ""):lower()

    local enriched = {}
    for key, value in pairs(params or {}) do enriched[key] = value end
    if enriched.target ~= nil and (enriched.target_group == nil or enriched.target_weight == nil) then
        local target = tostring(enriched.target)
        if target:lower() == "@me" or target == tostring(userid) then
            enriched.target = "@me"
            enriched.target_group, enriched.target_weight = "@me", -1
        else
            local group, weight = self:standing(target)
            if enriched.target_group == nil then enriched.target_group = group end
            if enriched.target_weight == nil then enriched.target_weight = weight end
        end
    end
    if enriched.group ~= nil and enriched.group_weight == nil then
        local record = self.groups_c:get(tostring(enriched.group):lower())
        if record then enriched.group_weight = tonumber(record.weight) or 0 end
    end
    params = enriched

    local sources = { { label = "user", entries = self:user_entries(userid) } }
    for _, group in ipairs(self:groups_of(userid)) do
        sources[#sources + 1] = { label = "group:" .. group.name, entries = self:entries_of(group.name) }
    end
    local fallback = self:default_group()
    if fallback then
        sources[#sources + 1] = { label = "group:" .. fallback, entries = self:entries_of(fallback) }
    end

    for _, source in ipairs(sources) do
        local best = best_in(source.entries, node)
        if best then
            if best.effect == "allow" and best.where then
                local violation = permissions.violation(best.where, params)
                if violation then return false, source.label, best.where, violation end
            end
            return best.effect == "allow", source.label, best.where
        end
    end

    local registered = self.nodes_c:get(node)
    if registered then return registered.default == "allow", "default", nil end
    return false, "unregistered", nil
end

-- The highest-weight tagged group a player belongs to — the [ROLE] shown in
-- chat. Falls back to the default group's tag when they are in no tagged one.
function permissions:role(userid)
    for _, group in ipairs(self:groups_of(userid)) do
        local record = self.groups_c:get(group.name)
        if record and record.tag and record.tag ~= "" then return record.tag end
    end
    local fallback = self:default_group()
    local record = fallback and self.groups_c:get(fallback)
    if record and record.tag and record.tag ~= "" then return record.tag end
    return nil
end

return permissions
