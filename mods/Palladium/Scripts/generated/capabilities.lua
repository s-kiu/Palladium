-- Generated from packages/shared/bridge-capabilities.json — do not edit. Regenerate: node packages/shared/generate.mjs
return {
    envelope = 2,
    events = {
    { type = "player.chat", hook = "/Script/Pal.PalPlayerController:EnterChat_Receive" },
    { type = "player.join", hook = "/Script/Pal.PalPlayerCharacter:OnCompleteInitializeParameter" },
    { type = "player.respawn", hook = "/Script/Pal.PalPlayerCharacter:OnCompleteInitializeParameter" },
    { type = "player.death", hook = "/Script/Pal.PalCharacter:OnDeadCharacter" },
    { type = "npc.spawn", hook = "/Script/Pal.PalCharacterParameterComponent:OnInitialize_AfterSetIndividualParameter" },
    },
    actions = {
        ["player.message"] = {
            target = "player",
            params = {
            { name = "text", kind = "string", required = true, max_len = 512 },
            },
        },
        ["player.give_item"] = {
            target = "player",
            params = {
            { name = "item", kind = "item_id", required = true },
            { name = "count", kind = "int", min = 1, max = 9999, default = 1 },
            },
        },
        ["player.teleport"] = {
            target = "player",
            params = {
            { name = "x", kind = "number", required = true },
            { name = "y", kind = "number", required = true },
            { name = "z", kind = "number", required = true },
            },
        },
        ["player.heal"] = {
            target = "player",
            params = {

            },
        },
        ["player.count_item"] = {
            target = "player",
            params = {
            { name = "item", kind = "item_id", required = true },
            },
        },
        ["player.has_item"] = {
            target = "player",
            params = {
            { name = "item", kind = "item_id", required = true },
            { name = "count", kind = "int", min = 1, max = 999999, default = 1 },
            },
        },
        ["pal.spawn"] = {
            target = "player",
            target_optional = true,
            params = {
            { name = "species", kind = "item_id", required = true },
            { name = "level", kind = "int", min = 1, max = 100, default = 10 },
            { name = "rare", kind = "bool", default = false },
            { name = "traits", kind = "string", max_len = 200 },
            { name = "x", kind = "number" },
            { name = "y", kind = "number" },
            { name = "z", kind = "number" },
            { name = "hostile", kind = "bool", default = false },
            },
        },
        ["player.position"] = {
            target = "player",
            params = {

            },
        },
        ["pal.list"] = {
            params = {

            },
        },
        ["player.stats"] = {
            target = "player",
            params = {

            },
        },
        ["player.set_stats"] = {
            target = "player",
            params = {
            { name = "hp", kind = "number", min = 0, max = 100000000 },
            { name = "maxHp", kind = "number", min = 1, max = 100000000 },
            { name = "hunger", kind = "number", min = 0, max = 1000 },
            { name = "shield", kind = "number", min = 0, max = 100000 },
            { name = "maxShield", kind = "number", min = 1, max = 100000 },
            { name = "level", kind = "int", min = 1, max = 100 },
            { name = "rank", kind = "int", min = 1, max = 5 },
            { name = "talentHp", kind = "int", min = 0, max = 100 },
            { name = "talentMelee", kind = "int", min = 0, max = 100 },
            { name = "talentShot", kind = "int", min = 0, max = 100 },
            { name = "talentDefense", kind = "int", min = 0, max = 100 },
            { name = "rankAttack", kind = "int", min = 0, max = 10 },
            { name = "rankDefence", kind = "int", min = 0, max = 10 },
            { name = "rankCraftSpeed", kind = "int", min = 0, max = 10 },
            },
        },
        ["player.status_points"] = {
            target = "player",
            params = {

            },
        },
        ["player.status_point"] = {
            target = "player",
            params = {
            { name = "stat", kind = "string", required = true, max_len = 32 },
            { name = "points", kind = "int", min = 1, max = 1000, default = 1 },
            },
        },
        ["pal.stats"] = {
            params = {
            { name = "pal", kind = "string", required = true, max_len = 64 },
            },
        },
        ["pal.set_stats"] = {
            params = {
            { name = "pal", kind = "string", required = true, max_len = 64 },
            { name = "hp", kind = "number", min = 0, max = 100000000 },
            { name = "maxHp", kind = "number", min = 1, max = 100000000 },
            { name = "hunger", kind = "number", min = 0, max = 1000 },
            { name = "shield", kind = "number", min = 0, max = 100000 },
            { name = "maxShield", kind = "number", min = 1, max = 100000 },
            { name = "level", kind = "int", min = 1, max = 100 },
            { name = "rank", kind = "int", min = 1, max = 5 },
            { name = "talentHp", kind = "int", min = 0, max = 100 },
            { name = "talentMelee", kind = "int", min = 0, max = 100 },
            { name = "talentShot", kind = "int", min = 0, max = 100 },
            { name = "talentDefense", kind = "int", min = 0, max = 100 },
            { name = "rankAttack", kind = "int", min = 0, max = 10 },
            { name = "rankDefence", kind = "int", min = 0, max = 10 },
            { name = "rankCraftSpeed", kind = "int", min = 0, max = 10 },
            },
        },
        ["pal.aggro"] = {
            target = "player",
            params = {
            { name = "pal", kind = "string", required = true, max_len = 64 },
            { name = "amount", kind = "int", min = 1, max = 100000, default = 1000 },
            },
        },
        ["pal.inspect"] = {
            params = {
            { name = "pal", kind = "string", required = true, max_len = 64 },
            },
        },
        ["pal.force_spawn"] = {
            target = "player",
            params = {
            { name = "kind", kind = "string", max_len = 16, default = "nearest" },
            { name = "radius", kind = "number", min = 0, max = 1000000, default = 50000 },
            },
        },
        ["bridge.probe"] = {
            target = "player",
            target_optional = true,
            params = {
            { name = "on", kind = "string", max_len = 64, default = "player" },
            { name = "pal", kind = "string", max_len = 64 },
            { name = "filter", kind = "string", max_len = 32 },
            },
        },
    },
}
