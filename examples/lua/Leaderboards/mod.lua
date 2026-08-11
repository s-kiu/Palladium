-- Leaderboards — who leads the server, refreshed on the clock, never on
-- demand.
--
-- The reference for polling-style mods: standings are collected on a
-- schedule the operator sets — the clock.minute event, every
-- refresh_minutes — and !lb answers from that collection without touching
-- the engine. A command that triggered engine work per use would hand any
-- player a lever on the server; a cadence does not.
--
-- Six boards, and they do not all age the same way. Everything but level is
-- read from records the server keeps, so it answers for a player who logged
-- off months ago. Level comes from player.stats, which only answers for
-- someone online, so an offline player keeps the level they were last seen
-- with.

local BOARDS = {
    level    = { title = "Level leaders",      format = "Lv %d" },
    playtime = { title = "Most time played",   format = "%dh" },
    captured = { title = "Most pals captured", format = "%d caught" },
    fished   = { title = "Most fish caught",   format = "%d fish" },
    crafted  = { title = "Most items crafted", format = "%d crafted" },
    bosses   = { title = "Most bosses beaten", format = "%d bosses" },
}
local ORDER = { "level", "playtime", "captured", "fished", "crafted", "bosses" }

local function roster(pal)
    return pal.data("standings")
end

-- Every write goes through here, so a refresh that only learns one number
-- never blanks the others.
local function record(pal, who, changes)
    local standings = roster(pal)
    local kept = standings:get(who) or {}
    local row = {
        name = changes.name or kept.name or "",
        level = changes.level or kept.level or "0",
        level_at = changes.level_at or kept.level_at or "0",
        minutes = changes.minutes or kept.minutes or "0",
        captured = changes.captured or kept.captured or "0",
        fished = changes.fished or kept.fished or "0",
        crafted = changes.crafted or kept.crafted or "0",
        bosses = changes.bosses or kept.bosses or "0",
        seen_at = tostring(os.time()),
    }
    standings:set(who, row)
end

local function refresh_one(pal, who)
    -- Online only, and the one board that has to be stamped: two players at
    -- the same level are ranked by who got there first, which is a fact about
    -- when we saw it, so it can only be learned going forward.
    pal.call("player.stats", who, {}, function(ok, _, told)
        if not ok then return end
        local level = tonumber(told.level) or 0
        local kept = roster(pal):get(who) or {}
        local before = tonumber(kept.level) or 0
        local stamped = tonumber(kept.level_at) or 0
        if level > before or stamped == 0 then
            record(pal, who, { level = tostring(level), level_at = tostring(os.time()) })
        else
            record(pal, who, { level = tostring(level) })
        end
    end)

    -- Both of these answer whether or not the player is online.
    pal.call("player.playtime", who, {}, function(ok, _, told)
        if not ok then return end
        record(pal, who, {
            minutes = tostring(tonumber(told.minutes) or 0),
            name = told.name ~= "" and told.name or nil,
        })
    end)
    pal.call("player.records", who, {}, function(ok, _, told)
        if not ok then return end
        record(pal, who, {
            captured = tostring(tonumber(told.captures) or 0),
            fished = tostring(tonumber(told.fished) or 0),
            crafted = tostring(tonumber(told.crafted) or 0),
            bosses = tostring(tonumber(told.bosses) or 0),
        })
    end)
end

local function refresh_all(pal)
    for who in pairs(roster(pal):all()) do
        refresh_one(pal, who)
    end
    -- Stamped by the sweep and nothing else: this is what !lb counts down
    -- from, so a one-off read for a newly seen player must not move it.
    pal.data("meta"):set("refresh", { at = tostring(os.time()) })
end

-- How long until the standings are read again. The sweep only runs on minutes
-- the interval divides, so the last sweep plus the interval is the next one.
local function next_refresh_in(pal)
    local last = tonumber((pal.data("meta"):get("refresh") or {}).at)
    if not last then return nil end
    local every = tonumber(pal.settings.refresh_minutes) or 5
    if every < 1 then every = 1 end
    local remaining = (last + every * 60) - os.time()
    if remaining < 0 then return 0 end
    return remaining
end

local function counted(seconds)
    if seconds < 60 then return seconds .. "s" end
    return math.floor(seconds / 60) .. "m"
end

-- Hours, because a leaderboard reading "14882" tells nobody anything.
local function score_of(board, entry)
    if board == "playtime" then return math.floor((tonumber(entry.minutes) or 0) / 60) end
    return tonumber(entry[board]) or 0
end

return {
    name = "Leaderboards",
    version = "1.3.0",
    description = "Who leads the server, refreshed on a cadence the operator sets.",

    -- Two levels, because "may use !lb" and "may see the crafting board" are
    -- different questions. The command node gates the word itself; a board
    -- node gates one board, so an operator can leave the boards on and take a
    -- single one away without touching the rest.
    permissions = {
        { node = "leaderboards.check", description = "ask who leads with !lb", default = "allow" },
        { node = "leaderboards.level", description = "see the level board", default = "allow" },
        { node = "leaderboards.playtime", description = "see the playtime board", default = "allow" },
        { node = "leaderboards.captured", description = "see the captures board", default = "allow" },
        { node = "leaderboards.fished", description = "see the fishing board", default = "allow" },
        { node = "leaderboards.crafted", description = "see the crafting board", default = "allow" },
        { node = "leaderboards.bosses", description = "see the bosses board", default = "allow" },
    },

    settings = {
        refresh_minutes = 5,     -- how often standings are re-read from the engine
        top = 3,                 -- how many names !lb answers with
        default_board = "level", -- which board a bare !lb shows
    },

    data = {
        standings = {
            description = "every player seen, their last known standings, and when",
            fields = {
                name = "string", level = "int", level_at = "int", minutes = "int",
                captured = "int", fished = "int", crafted = "int", bosses = "int",
                seen_at = "int",
            },
        },
        meta = {
            description = "when the standings were last swept",
            fields = { at = "int" },
        },
    },

    on = {
        -- A join puts the player on the roster and reads them once, so a
        -- first-timer appears without waiting out a refresh interval.
        ["player.join"] = function(event, pal)
            local who = event.subject and event.subject.id
            if not who or who == "" then return end
            record(pal, who, { name = event.subject.name or "" })
            refresh_one(pal, who)
        end,

        -- A join is the clean way onto the roster but not the only one. A
        -- player already in the world when this mod is installed, or one who
        -- connected while the server was still registering its hooks, never
        -- produces a join event at all — and refresh_all only sweeps players
        -- it already knows, so without this the standings stay empty for good.
        --
        -- Speaking costs one read, once, the first time we ever see someone:
        -- after that the cadence owns them and chat does nothing, so this is
        -- not a lever anybody can pull twice.
        ["player.chat"] = function(event, pal)
            local who = event.subject and event.subject.id
            if not who or who == "" then return end
            if roster(pal):get(who) then return end
            record(pal, who, { name = event.subject.name or "" })
            refresh_one(pal, who)
        end,

        -- The cadence: nothing here runs because somebody asked — it runs
        -- because the minute turned and the operator's interval divides it.
        ["clock.minute"] = function(event, pal)
            local every = tonumber(pal.settings.refresh_minutes) or 5
            if every < 1 then every = 1 end
            local minute = tonumber(event.data and event.data.minute) or 0
            if minute % every ~= 0 then return end
            refresh_all(pal)
        end,
    },

    commands = {
        ["!lb"] = {
            node = "leaderboards.check",
            help = "!lb [level|playtime|captured|fished|crafted|bosses] — the current leaders.",
            run = function(event, args, pal)
                local who = event.subject and event.subject.id
                if not who or who == "" then return end

                -- A command is handed the rest of the line as text, not as a
                -- parsed list: the first word is the board, no word is level.
                -- A bare !lb is whichever board the operator made the default,
                -- because a fishing server and a levelling server do not want
                -- the same one. A default naming a board that does not exist
                -- falls back rather than refusing: the player typed nothing
                -- wrong, and telling them so would be a lie.
                local board = tostring(args or ""):match("^%s*(%S+)")
                if board then
                    board = board:lower()
                else
                    board = tostring(pal.settings.default_board or "level"):lower()
                    if not BOARDS[board] then board = "level" end
                end

                -- Only what this caller may actually see, so a refusal never
                -- advertises a board they cannot ask for anyway.
                local offered = {}
                for _, name in ipairs(ORDER) do
                    if pal.can(who, "leaderboards." .. name) then offered[#offered + 1] = name end
                end
                if #offered == 0 then
                    pal.player.message(who, { text = "You are not allowed to see any board." })
                    return
                end
                if not BOARDS[board] then
                    pal.player.message(who, {
                        text = "No such board. Try: " .. table.concat(offered, ", "),
                    })
                    return
                end
                if not pal.can(who, "leaderboards." .. board) then
                    pal.player.message(who, {
                        text = "You are not allowed to see the " .. board .. " board. Try: "
                            .. table.concat(offered, ", "),
                    })
                    return
                end

                local rows = {}
                for _, entry in pairs(roster(pal):all()) do
                    rows[#rows + 1] = {
                        name = entry.name ~= "" and entry.name or "?",
                        score = score_of(board, entry),
                        at = tonumber(entry.level_at) or 0,
                    }
                end
                if #rows == 0 then
                    pal.player.message(who, { text = "Nobody on the board yet — standings fill as players are seen." })
                    return
                end

                -- Score first, then who got there first, then the name so the
                -- order is total: an incomplete comparison is a sort error,
                -- not merely an odd ranking.
                table.sort(rows, function(a, b)
                    if a.score ~= b.score then return a.score > b.score end
                    if a.at ~= b.at then return a.at < b.at end
                    return a.name < b.name
                end)

                -- One message per line: chat carries no line break of its own,
                -- so a board that should read as a list has to be sent as one.
                local function say(text)
                    pal.player.message(who, { text = text })
                end

                say(BOARDS[board].title)
                local top = tonumber(pal.settings.top) or 3
                for i = 1, math.min(top, #rows) do
                    say(string.format("%d. %s (" .. BOARDS[board].format .. ")",
                        i, rows[i].name, rows[i].score))
                end

                -- The footer carries the two things the list cannot say for
                -- itself: that it answers from a cache, and that other boards
                -- exist. Nobody reads a help command — the place to say what
                -- else there is is the answer they already asked for.
                local footer = {}
                local due = next_refresh_in(pal)
                if due then footer[#footer + 1] = "next refresh in " .. counted(due) end

                local others = {}
                for _, name in ipairs(offered) do
                    if name ~= board then others[#others + 1] = "!lb " .. name end
                end
                if #others > 0 then
                    footer[#footer + 1] = "try: " .. table.concat(others, ", ")
                end
                if #footer > 0 then say(table.concat(footer, "  ·  ")) end
            end,
        },
    },
}
