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
            params = {
            { name = "text", kind = "string", required = true, max_len = 512 },
            },
        },
        ["player.give_item"] = {
            params = {
            { name = "item", kind = "item_id", required = true },
            { name = "count", kind = "int", min = 1, max = 9999, default = 1 },
            },
        },
        ["player.teleport"] = {
            params = {
            { name = "x", kind = "number", required = true },
            { name = "y", kind = "number", required = true },
            { name = "z", kind = "number", required = true },
            },
        },
        ["player.heal"] = {
            params = {

            },
        },
        ["player.count_item"] = {
            params = {
            { name = "item", kind = "item_id", required = true },
            },
        },
        ["player.has_item"] = {
            params = {
            { name = "item", kind = "item_id", required = true },
            { name = "count", kind = "int", min = 1, max = 999999, default = 1 },
            },
        },
        ["pal.spawn"] = {
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
            params = {

            },
        },
        ["pal.list"] = {
            params = {

            },
        },
        ["player.stats"] = {
            params = {

            },
        },
        ["player.set_stats"] = {
            params = {
            { name = "hp", kind = "number", min = 0, max = 1 },
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
        ["pal.stats"] = {
            params = {
            { name = "pal", kind = "string", required = true, max_len = 64 },
            },
        },
        ["pal.set_stats"] = {
            params = {
            { name = "pal", kind = "string", required = true, max_len = 64 },
            { name = "hp", kind = "number", min = 0, max = 1 },
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
    },
}
