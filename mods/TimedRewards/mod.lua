-- TimedRewards — reach an hour mark on this server, earn that mark's reward.
--
-- The marks are settings, which makes them the operator's: a settings.config
-- beside this mod redefines the whole ladder without touching this file —
--
--   rewards.1.hours = 1
--   rewards.1.item = PalSphere
--   rewards.1.count = 5
--   rewards.2.hours = 10
--   rewards.2.item = Money
--   rewards.2.count = 1500
--
-- Settlement, not scheduling: the agent counts playtime and fires
-- player.hour when an hour completes; this mod pays every mark at or below
-- the hours played that has not been paid before. Claims are remembered per
-- mark, so a restart owes nobody double — and a mark added later, below
-- what someone already played, is simply owed at the next sight of them.

local function claimed_set(text)
    local set = {}
    for mark in tostring(text or ""):gmatch("%S+") do set[mark] = true end
    return set
end

local function settle(who, name, pal, always_tell)
    pal.call("player.playtime", who, {}, function(ok, _, told)
        if not ok then return end
        local played = math.floor((tonumber(told.minutes) or 0) / 60)
        local ledger = pal.data("claimed")
        local record = ledger:get(who) or {}
        local set = claimed_set(record.marks)

        local owed, next_mark = {}, nil
        for _, reward in ipairs(pal.settings.rewards) do
            local mark = tostring(tonumber(reward.hours) or 0)
            if (tonumber(reward.hours) or 0) <= played then
                if not set[mark] then owed[#owed + 1] = reward end
            elseif next_mark == nil or tonumber(reward.hours) < next_mark then
                next_mark = tonumber(reward.hours)
            end
        end

        if #owed == 0 then
            if always_tell then
                pal.message(who, next_mark
                    and string.format("%d hour(s) played; the next reward waits at %d.", played, next_mark)
                    or string.format("%d hour(s) played; every reward is already yours.", played))
            end
            return
        end
        if not pal.can(who, "timedrewards.reward") then return end

        for _, reward in ipairs(owed) do
            pal.give(who, reward.item, tonumber(reward.count) or 1)
            set[tostring(tonumber(reward.hours) or 0)] = true
            pal.message(who, string.format("%d hour(s) on the server: %s x%d is yours.",
                reward.hours, reward.item, tonumber(reward.count) or 1))
        end
        local marks = {}
        for mark in pairs(set) do marks[#marks + 1] = mark end
        table.sort(marks, function(a, b) return tonumber(a) < tonumber(b) end)
        ledger:set(who, { name = name, marks = table.concat(marks, " "), last_at = os.time() })
    end)
end

local function on_event(event, pal)
    local who = event.subject and event.subject.id
    if not who or who == "" then return end
    settle(who, event.subject.name or "", pal, false)
end

return {
    name = "TimedRewards",
    version = "1.0.0",
    description = "Reach an hour mark on this server, earn that mark's reward.",

    permissions = {
        { node = "timedrewards.reward", description = "earn the playtime milestone rewards", default = "allow" },
        { node = "timedrewards.check", description = "ask about your next milestone with !rewards", default = "allow" },
    },

    settings = {
        -- The author's ladder; settings.config replaces it wholesale.
        rewards = {
            { hours = 1, item = "PalSphere", count = 5 },
            { hours = 5, item = "Money", count = 500 },
            { hours = 10, item = "Money", count = 1500 },
        },
    },

    data = {
        claimed = {
            description = "which hour marks each player has already been rewarded for",
            fields = { name = "string", marks = "string", last_at = "int" },
        },
    },

    on = {
        ["player.hour"] = on_event, -- fires when a played hour completes
        ["player.join"] = on_event, -- settles anything owed from before
    },

    commands = {
        ["!rewards"] = {
            node = "timedrewards.check",
            help = "!rewards — your hour marks: what you have claimed and where the next one waits.",
            run = function(event, _args, pal)
                local who = event.subject and event.subject.id
                if who and who ~= "" then settle(who, event.subject.name or "", pal, true) end
            end,
        },
    },
}
