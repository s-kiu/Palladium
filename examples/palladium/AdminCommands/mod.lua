-- AdminCommands — the moderator's toolkit, as chat commands.
--
-- Every command here is gated by its own node, all denied by default, so
-- installing this mod hands nobody anything until an operator says so. Grant
-- them to a moderators group and its members get exactly those words.
--
-- Targets are written the way chat already writes them: @Name for an online
-- player, @me for yourself, and no target at all also means yourself. Names
-- are resolved through Palladium rather than guessed, so a name nobody online
-- carries is refused rather than acted on.
--
-- What is NOT here, and why — because a command that silently does nothing is
-- worse than one that does not exist:
--   mute         Palladium observes chat, it cannot cancel it, so a muted
--                player's words would still reach everyone. !mute here stops
--                them using commands, which is the part that is real.
--   kick, ban    they live in the game's REST API, which the panel can reach
--                and a mod inside the game cannot.
-- The README says the same in more words.

local function trim(text)
    return (tostring(text or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end

-- @Name, @me, or nothing. Returns id, error — never a guess.
local function resolve(token, caller, pal)
    token = trim(token)
    if token == "" or token == "@me" then return caller, nil end
    local name = token:match("^@(.+)$")
    if not name then return nil, string.format('"%s" is not a target — write @Name or @me', token) end
    local id = pal.player_by_name(name)
    if not id then return nil, string.format("nobody online is called %s", name) end
    return id, nil
end

local function words(args)
    local out = {}
    for word in tostring(args or ""):gmatch("%S+") do out[#out + 1] = word end
    return out
end

local function say(pal, who, text)
    pal.player.message(who, { text = text })
end

-- Muted players are held in a collection rather than in memory: a mute that a
-- restart forgets is not a mute.
local function is_muted(pal, id)
    return pal.data("muted"):get(id) ~= nil
end

return {
    name = "AdminCommands",
    version = "1.0.0",
    api = 1,
    description = "Moderator commands: teleport, give, slay, god and mute.",

    permissions = {
        { node = "admincommands.tp", description = "teleport yourself or another player", default = "deny" },
        { node = "admincommands.give", description = "give items to a player", default = "deny" },
        { node = "admincommands.slay", description = "kill a player outright", default = "deny" },
        { node = "admincommands.god", description = "make a player unkillable", default = "deny" },
        { node = "admincommands.fly", description = "let a player fly", default = "deny" },
        { node = "admincommands.freeze", description = "hold a player still", default = "deny" },
        { node = "admincommands.mute", description = "stop a player using chat commands", default = "deny" },
    },

    settings = {
        -- Told to everyone when an admin slays somebody, so a death nobody
        -- caused in game is not a mystery. Empty to keep it quiet.
        announce_slay = true,
    },

    data = {
        muted = {
            description = "players whose chat commands are ignored, and who muted them",
            fields = { name = "string", by = "string", at = "int" },
        },
        -- Immortality is a flag on the character, not something this mod
        -- holds, but who has it is worth surviving a restart so an operator
        -- can see who is still unkillable.
        godded = {
            description = "players currently made immortal, and when",
            fields = { name = "string", was_max_hp = "string", at = "int" },
        },
    },

    commands = {
        -- !tp @karl            take me to karl
        -- !tp @peter @karl     take peter to karl
        ["!tp"] = {
            node = "admincommands.tp",
            help = "!tp @Name — go to them. !tp @Name @Other — send the first to the second.",
            run = function(event, args, pal)
                local caller = event.subject.id
                if is_muted(pal, caller) then return end
                local parts = words(args)
                if #parts == 0 then
                    return say(pal, caller, "Who to? !tp @Name, or !tp @Name @Other.")
                end

                -- One name is a destination; two are a subject and a
                -- destination. Reading it this way is what makes the short
                -- form the common one.
                local subject_token, destination_token
                if #parts == 1 then
                    subject_token, destination_token = "@me", parts[1]
                else
                    subject_token, destination_token = parts[1], parts[2]
                end

                local subject, trouble = resolve(subject_token, caller, pal)
                if trouble then return say(pal, caller, trouble) end
                local destination, trouble2 = resolve(destination_token, caller, pal)
                if trouble2 then return say(pal, caller, trouble2) end
                if subject == destination then
                    return say(pal, caller, "That would put them where they already are.")
                end

                pal.player.teleport(subject, { to = destination }, function(ok, err)
                    if not ok then return say(pal, caller, "Teleport failed: " .. tostring(err)) end
                    say(pal, caller, "Done.")
                    if subject ~= caller then say(pal, subject, "An admin moved you.") end
                end)
            end,
        },

        -- !give @Name PalSphere 5   — or !give PalSphere 5 for yourself
        ["!give"] = {
            node = "admincommands.give",
            help = "!give @Name <item> [count] — hand items over. Item ids are the game's own (gold is Money).",
            run = function(event, args, pal)
                local caller = event.subject.id
                if is_muted(pal, caller) then return end
                local parts = words(args)
                local target_token = ""
                if parts[1] and parts[1]:sub(1, 1) == "@" then target_token = table.remove(parts, 1) end

                local item, count = parts[1], tonumber(parts[2]) or 1
                if not item then
                    return say(pal, caller, "What item? !give @Name <item> [count]")
                end
                local target, trouble = resolve(target_token, caller, pal)
                if trouble then return say(pal, caller, trouble) end

                -- give_item reads the inventory back, so ok here means the
                -- items actually arrived rather than that the call returned.
                pal.player.give_item(target, { item = item, count = count }, function(ok, err)
                    if not ok then return say(pal, caller, "Nothing arrived: " .. tostring(err)) end
                    say(pal, caller, string.format("Gave %s x%d.", item, count))
                    if target ~= caller then
                        say(pal, target, string.format("An admin gave you %s x%d.", item, count))
                    end
                end)
            end,
        },

        ["!slay"] = {
            node = "admincommands.slay",
            help = "!slay @Name — kill them outright.",
            run = function(event, args, pal)
                local caller = event.subject.id
                if is_muted(pal, caller) then return end
                local target, trouble = resolve(words(args)[1] or "", caller, pal)
                if trouble then return say(pal, caller, trouble) end

                pal.player.set_stats(target, { hp = 0 }, function(ok, err, data)
                    -- The engine may accept the write and clamp it, so the
                    -- answer is read rather than assumed.
                    local applied = tostring(data and data.applied or "")
                    if not ok or not applied:find("hp", 1, true) then
                        return say(pal, caller, "Could not slay them: " .. tostring(err or "the write did not take"))
                    end
                    say(pal, caller, "Done.")
                    if pal.settings.announce_slay then
                        pal.server.announce({ message = (event.subject.name or "An admin") .. " smote a player." })
                    end
                end)
            end,
        },

        -- The engine's own immortality flag, replicated to the client. It
        -- replaced a maximum-health ceiling that could not work: health here
        -- is derived from level, so a raised maximum does not stay raised.
        ["!god"] = {
            node = "admincommands.god",
            help = "!god @Name [off] — make them unkillable, or mortal again.",
            run = function(event, args, pal)
                local caller = event.subject.id
                if is_muted(pal, caller) then return end
                local parts = words(args)
                local target_token = ""
                if parts[1] and parts[1]:sub(1, 1) == "@" then target_token = table.remove(parts, 1) end
                local off = (parts[1] or ""):lower() == "off"

                local target, trouble = resolve(target_token, caller, pal)
                if trouble then return say(pal, caller, trouble) end

                pal.player.set_immortal(target, { on = not off }, function(ok, err)
                    if not ok then
                        return say(pal, caller, "Could not change that: " .. tostring(err))
                    end
                    -- Remembered so !godded can answer, and so an operator can
                    -- see who is still immortal after a restart.
                    local ledger = pal.data("godded")
                    if off then ledger:delete(target)
                    else ledger:set(target, { name = "", was_max_hp = "", at = os.time() }) end

                    say(pal, caller, off and "God mode off." or "God mode on.")
                    if target ~= caller then
                        say(pal, target, off and "You are mortal again." or "An admin made you unkillable.")
                    end
                end)
            end,
        },

        -- Flight and freeze are the framework's work, not this mod's: both
        -- are capabilities, so they are equally a chat command, an HTTP call
        -- and something any other mod can reach.
        ["!fly"] = {
            node = "admincommands.fly",
            help = "!fly @Name [off] — take off, or land.",
            run = function(event, args, pal)
                local caller = event.subject.id
                if is_muted(pal, caller) then return end
                local parts = words(args)
                local target_token = ""
                if parts[1] and parts[1]:sub(1, 1) == "@" then target_token = table.remove(parts, 1) end
                local off = (parts[1] or ""):lower() == "off"
                local target, trouble = resolve(target_token, caller, pal)
                if trouble then return say(pal, caller, trouble) end

                pal.player.set_flying(target, { on = not off }, function(ok, err)
                    if not ok then return say(pal, caller, "Could not do that: " .. tostring(err)) end
                    -- Nothing reports flight back, so this says what was asked.
                    say(pal, caller, off and "Asked them to land." or "Asked them to take off.")
                end)
            end,
        },

        ["!freeze"] = {
            node = "admincommands.freeze",
            help = "!freeze @Name [off] — hold them still, or let them go.",
            run = function(event, args, pal)
                local caller = event.subject.id
                if is_muted(pal, caller) then return end
                local parts = words(args)
                local target_token = ""
                if parts[1] and parts[1]:sub(1, 1) == "@" then target_token = table.remove(parts, 1) end
                local off = (parts[1] or ""):lower() == "off"
                local target, trouble = resolve(target_token, caller, pal)
                if trouble then return say(pal, caller, trouble) end
                if target == caller and not off then
                    return say(pal, caller, "Freeze somebody else — you would not be able to undo it.")
                end

                pal.player.set_frozen(target, { on = not off }, function(ok, err)
                    if not ok then return say(pal, caller, "Could not do that: " .. tostring(err)) end
                    say(pal, caller, off and "Released." or "Frozen.")
                    say(pal, target, off and "You can move again." or "An admin froze you.")
                end)
            end,
        },

        -- Muting stops the commands, not the talking: Palladium sees chat, it
        -- does not carry it, so the words still reach the room.
        ["!mute"] = {
            node = "admincommands.mute",
            help = "!mute @Name — ignore their chat commands. !mute @Name off to lift it.",
            run = function(event, args, pal)
                local caller = event.subject.id
                local parts = words(args)
                local target_token = ""
                if parts[1] and parts[1]:sub(1, 1) == "@" then target_token = table.remove(parts, 1) end
                local off = (parts[1] or ""):lower() == "off"

                local target, trouble = resolve(target_token, caller, pal)
                if trouble then return say(pal, caller, trouble) end
                if target == caller then return say(pal, caller, "Mute somebody else.") end

                local muted = pal.data("muted")
                if off then
                    if not muted:get(target) then return say(pal, caller, "They are not muted.") end
                    muted:delete(target)
                    say(pal, caller, "Unmuted.")
                    say(pal, target, "An admin lifted your mute.")
                    return
                end

                muted:set(target, { name = "", by = event.subject.name or caller, at = os.time() })
                say(pal, caller, "Muted — their commands are ignored. Their chat still reaches the server.")
                say(pal, target, "An admin muted your commands.")
            end,
        },
    },
}
