-- HourlyReward — every full hour actually played is worth something.
--
-- The agent counts playtime minute by minute and says so: `player.hour`
-- fires the moment a player's counted time completes another hour. That
-- event is the schedule — this mod owns no timer and no loop. The join
-- handler settles anything that completed while the reward was switched
-- off or the mod was absent: paid hours only ever chase played hours, so
-- a restart owes nobody double and loses nobody an hour.

local function settle(who, name, pal, always_tell)
    pal.call("player.playtime", who, {}, function(ok, _, told)
        if not ok then return end
        local minutes = tonumber(told.minutes) or 0
        local played = math.floor(minutes / 60)
        local paid = pal.data("paid")
        local record = paid:get(who) or {}
        local owed = played - (tonumber(record.hours) or 0)

        if owed <= 0 then
            if always_tell then
                pal.message(who, string.format(
                    "%d hour(s) played, next reward in %d minute(s).",
                    played, 60 - (minutes % 60)))
            end
            return
        end
        if not pal.can(who, "hourlyreward.reward") then return end

        for _, prize in ipairs(pal.settings.items) do
            pal.give(who, prize.item, prize.count * owed)
        end
        paid:set(who, { name = name, hours = played, last_at = os.time() })
        pal.message(who, string.format("Hour %d on the server — enjoy your reward%s.",
            played, owed > 1 and (" (x" .. owed .. ")") or ""))
        if pal.settings.announce then
            pal.announce(string.format("%s has now played %d hour(s) here.", name, played))
        end
    end)
end

local function on_event(event, pal)
    local who = event.subject and event.subject.id
    if not who or who == "" then return end
    settle(who, event.subject.name or "", pal, false)
end

return {
    name = "HourlyReward",
    version = "1.0.0",
    description = "Every full hour played is worth something.",

    -- Allow by default: a thing every player is meant to have. Deny
    -- `hourlyreward.reward` for the default group and allow it for one to
    -- turn it into a perk — this file never needs to know.
    permissions = {
        { node = "hourlyreward.reward", description = "earn the hourly playtime reward", default = "allow" },
        { node = "hourlyreward.check", description = "ask about your hours with !hours", default = "allow" },
    },

    settings = {
        -- Per full hour. Item ids are internal names: gold is `Money`.
        items = {
            { item = "Money", count = 100 },
        },
        announce = false,
    },

    data = {
        paid = {
            description = "how many full hours each player has been rewarded for",
            fields = { name = "string", hours = "int", last_at = "int" },
        },
    },

    on = {
        ["player.hour"] = on_event, -- fires when a played hour completes
        ["player.join"] = on_event, -- settles anything owed from before
    },

    commands = {
        ["!hours"] = {
            node = "hourlyreward.check",
            help = "!hours — your played time, and it settles any reward you are owed.",
            run = function(event, _args, pal)
                local who = event.subject and event.subject.id
                if who and who ~= "" then settle(who, event.subject.name or "", pal, true) end
            end,
        },
    },
}
