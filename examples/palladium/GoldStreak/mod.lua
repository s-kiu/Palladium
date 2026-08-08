-- GoldStreak — every fifth respawn is worth something.
--
-- The whole mod is this table. Palladium loads the file, reads what it
-- declares, registers the permission node, and calls the handlers; nothing
-- here connects to anything or asks to be started.
--
-- The streak is a tag on the player, so it survives a restart and this file
-- keeps no state of its own. Tags are namespaced per mod — this one is stored
-- as `goldstreak.respawns` — so no two mods can collide on a name.

return {
    name = "GoldStreak",
    version = "1.0.1",
    description = "Gold for sticking with it: a reward on every fifth respawn.",

    permissions = {
        { node = "goldstreak.reward", description = "earn gold on a respawn streak", default = "allow" },
    },

    -- The author's defaults; a settings.config beside the mod overrides
    -- them, live, without touching this file.
    settings = { every = 5, item = "Money", count = 50 },

    on = {
        ["player.respawn"] = function(event, pal)
            local who = event.subject and event.subject.id
            if not who or not pal.can(who, "goldstreak.reward") then return end

            -- An unset tag reads as nil and a corrupted one as nil too; both
            -- start the count over rather than stopping the mod.
            local streak = (tonumber(pal.tag(who, "respawns")) or 0) + 1
            pal.set_tag(who, "respawns", streak)
            if streak % pal.settings.every ~= 0 then return end

            -- player.give_item reads the inventory back, so ok means the gold is
            -- there — a payout that did not arrive is logged, not announced.
            pal.player.give_item(who, { item = pal.settings.item, count = pal.settings.count }, function(ok, err)
                if not ok then
                    pal.log(string.format("%s: %s x%d failed — %s",
                        event.subject.name, pal.settings.item, pal.settings.count, tostring(err)))
                    return
                end
                pal.player.message(who, { text = string.format(
                    "Respawn %d — here is %d gold for your trouble.", streak, pal.settings.count) })
            end)
        end,
    },

    commands = {
        ["!streak"] = {
            description = "how many respawns until the next payout",
            node = "goldstreak.reward",
            run = function(event, _args, pal)
                local streak = tonumber(pal.tag(event.subject.id, "respawns")) or 0
                local togo = pal.settings.every - (streak % pal.settings.every)
                pal.player.message(event.subject.id, { text = string.format(
                    "Respawns: %d. Next payout in %d.", streak, togo) })
            end,
        },
    },
}
