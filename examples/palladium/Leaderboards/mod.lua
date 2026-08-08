-- Leaderboards — who leads the server, refreshed on the clock, never on
-- demand.
--
-- The reference for polling-style mods: standings are collected on a
-- schedule the operator sets — the clock.minute event, every
-- refresh_minutes — and !lb answers from that collection without touching
-- the engine. A command that triggered engine work per use would hand any
-- player a lever on the server; a cadence does not. Levels come from
-- player.stats, which only answers for online players, so an offline
-- player keeps the last level they were seen with.

local function roster(pal)
    return pal.data("standings")
end

local function remember(pal, who, name)
    local standings = roster(pal)
    local record = standings:get(who) or {}
    standings:set(who, {
        name = name ~= "" and name or (record.name or ""),
        level = record.level or "0",
        seen_at = tostring(os.time()),
    })
end

local function refresh_one(pal, who)
    pal.call("player.stats", who, {}, function(ok, _, told)
        if not ok then return end -- offline keeps the last known level
        local standings = roster(pal)
        local record = standings:get(who) or {}
        standings:set(who, {
            name = record.name or "",
            level = tostring(tonumber(told.level) or 0),
            seen_at = tostring(os.time()),
        })
    end)
end

local function refresh_all(pal)
    for who in pairs(roster(pal):all()) do
        refresh_one(pal, who)
    end
end

return {
    name = "Leaderboards",
    version = "1.0.0",
    description = "Who leads the server, refreshed on a cadence the operator sets.",

    permissions = {
        { node = "leaderboards.check", description = "ask who leads with !lb", default = "allow" },
    },

    settings = {
        refresh_minutes = 5, -- how often standings are re-read from the engine
        top = 3,             -- how many names !lb answers with
    },

    data = {
        standings = {
            description = "every player seen, their last known level, and when",
            fields = { name = "string", level = "int", seen_at = "int" },
        },
    },

    on = {
        -- A join puts the player on the roster and reads them once, so a
        -- first-timer appears without waiting out a refresh interval.
        ["player.join"] = function(event, pal)
            local who = event.subject and event.subject.id
            if not who or who == "" then return end
            remember(pal, who, event.subject.name or "")
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
            help = "!lb [level] — the current level leaders, from the last scheduled refresh.",
            run = function(event, _args, pal)
                local who = event.subject and event.subject.id
                if not who or who == "" then return end
                local rows = {}
                for _, record in pairs(roster(pal):all()) do
                    rows[#rows + 1] = {
                        name = record.name ~= "" and record.name or "?",
                        level = tonumber(record.level) or 0,
                    }
                end
                if #rows == 0 then
                    pal.player.message(who, { text = "Nobody on the board yet — standings fill as players are seen." })
                    return
                end
                table.sort(rows, function(a, b) return a.level > b.level end)
                local top = tonumber(pal.settings.top) or 3
                local parts = {}
                for i = 1, math.min(top, #rows) do
                    parts[#parts + 1] = string.format("%d. %s (Lv %d)", i, rows[i].name, rows[i].level)
                end
                pal.player.message(who, { text = "Level leaders: " .. table.concat(parts, "  ") })
            end,
        },
    },
}
