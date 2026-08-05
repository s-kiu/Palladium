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
        ["player.set_hp"] = {
            params = {
            { name = "rate", kind = "number", required = true, min = 0, max = 1 },
            },
        },
        ["player.set_hunger"] = {
            params = {
            { name = "value", kind = "number", required = true, min = 0, max = 1000 },
            },
        },
        ["player.set_shield"] = {
            params = {
            { name = "hp", kind = "number", required = true, min = 0, max = 100000 },
            { name = "max", kind = "number", min = 1, max = 100000 },
            },
        },
        ["pal.list"] = {
            params = {

            },
        },
        ["pal.set_hp"] = {
            params = {
            { name = "pal", kind = "string", required = true, max_len = 64 },
            { name = "rate", kind = "number", required = true, min = 0, max = 1 },
            },
        },
    },
}
