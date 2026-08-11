-- WelcomeKit — a starter kit for players joining for the first time.
--
-- Two things Palladium answers make this short. The join event arrives with
-- `firstEver` already decided, because the player registry outlives the event
-- file and every reboot. And the claim is a tag on the player rather than
-- state in here, so a crash between the hand-out and the next boot cannot
-- produce a second kit, and neither can a second copy of this mod.
--
-- The kit is only marked claimed once the items have actually arrived:
-- `player.give_item` reads the inventory back, because the engine accepts a grant of
-- an unknown item id and reports success having added nothing.

return {
    name = "WelcomeKit",
    version = "2.1.0",
    api = 1,
    description = "A starter kit for players joining for the first time, once ever.",

    permissions = {
        { node = "welcomekit.kit", description = "receive the starter kit on first join", default = "allow" },
    },

    -- The author's defaults; a settings.config beside the mod overrides
    -- them, live, without touching this file.
    settings = {
        -- Item ids are the game's internal names, not the names shown in game:
        -- bread is `Pan`, medical supplies are `Medicines`, gold is `Money`.
        items = {
            { item = "PalSphere", count = 10 },
            { item = "Pan", count = 5 },
        },
        announce = true,
    },

    on = {
        ["player.join"] = function(event, pal)
            local who = event.subject and event.subject.id
            if not who or who == "" then return end
            local name = event.subject.name

            local claimed = pal.tag(who, "claimed")
            if not event.data.firstEver or claimed ~= nil then
                pal.player.message(who, { text = "Welcome back, " .. name .. "." })
                pal.log(string.format("%s: greeted (%s)", name,
                    claimed ~= nil and "kit already claimed" or ("join #" .. tostring(event.data.joins or "?"))))
                return
            end

            local allowed = pal.can(who, "welcomekit.kit")
            pal.player.message(who, { text = allowed
                and ("Welcome to the server, " .. name .. "! Here is a starter kit to get you going.")
                or ("Welcome to the server, " .. name .. "!") })

            if pal.settings.announce ~= false then
                pal.server.announce({ message = name .. " just joined for the first time — say hi!" })
            end

            if not allowed then
                pal.log(name .. ": first join, no welcomekit.kit — greeted without a kit")
                return
            end

            -- Hand-outs answer one at a time, so the claim waits until the last
            -- of them has: a kit that only half arrived is not a claimed kit.
            local items = pal.settings.items or {}
            local outstanding, missed = #items, nil
            if outstanding == 0 then return end

            for _, entry in ipairs(items) do
                pal.player.give_item(who, { item = entry.item, count = entry.count }, function(ok, err)
                    if not ok then
                        missed = entry.item
                        pal.log(string.format('%s: %s x%d did not arrive (%s) — is "%s" a real item id?',
                            name, entry.item, entry.count, tostring(err), entry.item))
                    end
                    outstanding = outstanding - 1
                    if outstanding > 0 then return end

                    if missed then
                        pal.player.message(who, { text = "Part of your starter kit could not be handed over — ask an admin for it." })
                        return
                    end
                    pal.set_tag(who, "claimed", os.time())
                    pal.log(name .. ": kit delivered")
                end)
            end
        end,
    },

    commands = {
        ["!kit"] = {
            node = "welcomekit.kit",
            help = "!kit — whether your starter kit has been delivered.",
            run = function(event, _args, pal)
                local who = event.subject and event.subject.id
                if not who or who == "" then return end
                pal.player.message(who, { text = pal.tag(who, "claimed")
                    and "Your starter kit was delivered."
                    or "No kit claimed yet — it arrives on your first-ever join." })
            end,
        },
    },
}
