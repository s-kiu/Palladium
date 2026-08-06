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
        ["player.set_tag"] = {
            target = "player",
            target_optional = true,
            params = {
            { name = "key", kind = "string", required = true, max_len = 64 },
            { name = "value", kind = "string", required = true, max_len = 512 },
            },
        },
        ["player.get_tag"] = {
            target = "player",
            target_optional = true,
            params = {
            { name = "key", kind = "string", required = true, max_len = 64 },
            },
        },
        ["player.delete_tag"] = {
            target = "player",
            target_optional = true,
            params = {
            { name = "key", kind = "string", required = true, max_len = 64 },
            },
        },
        ["permission.register"] = {
            params = {
            { name = "mod", kind = "string", required = true, max_len = 32 },
            { name = "node", kind = "string", required = true, max_len = 128 },
            { name = "description", kind = "string", max_len = 200 },
            { name = "default", kind = "string", max_len = 8 },
            },
        },
        ["permission.check"] = {
            target = "player",
            target_optional = true,
            params = {
            { name = "node", kind = "string", required = true, max_len = 128 },
            },
        },
        ["permission.grant"] = {
            target = "player",
            target_optional = true,
            params = {
            { name = "node", kind = "string", required = true, max_len = 128 },
            { name = "effect", kind = "string", max_len = 8, default = "allow" },
            { name = "constraints", kind = "json" },
            },
        },
        ["permission.revoke"] = {
            target = "player",
            target_optional = true,
            params = {
            { name = "node", kind = "string", required = true, max_len = 128 },
            },
        },
        ["permission.nodes"] = {
            params = {

            },
        },
        ["permission.player"] = {
            target = "player",
            target_optional = true,
            params = {

            },
        },
        ["group.create"] = {
            params = {
            { name = "name", kind = "item_id", required = true },
            { name = "tag", kind = "string", max_len = 16 },
            { name = "weight", kind = "int", min = 0, max = 1000, default = 0 },
            },
        },
        ["group.update"] = {
            params = {
            { name = "name", kind = "item_id", required = true },
            { name = "tag", kind = "string", max_len = 16 },
            { name = "weight", kind = "int", min = 0, max = 1000, default = 0 },
            },
        },
        ["group.delete"] = {
            params = {
            { name = "name", kind = "item_id", required = true },
            },
        },
        ["group.set_entry"] = {
            params = {
            { name = "group", kind = "item_id", required = true },
            { name = "node", kind = "string", required = true, max_len = 128 },
            { name = "effect", kind = "string", max_len = 8, default = "allow" },
            { name = "constraints", kind = "json" },
            },
        },
        ["group.remove_entry"] = {
            params = {
            { name = "group", kind = "item_id", required = true },
            { name = "node", kind = "string", required = true, max_len = 128 },
            },
        },
        ["group.assign"] = {
            target = "player",
            target_optional = true,
            params = {
            { name = "group", kind = "item_id", required = true },
            },
        },
        ["group.unassign"] = {
            target = "player",
            target_optional = true,
            params = {
            { name = "group", kind = "item_id", required = true },
            },
        },
        ["group.list"] = {
            params = {

            },
        },
        ["player.position"] = {
            target = "player",
            params = {

            },
        },
        ["location.save"] = {
            params = {
            { name = "name", kind = "string", required = true, max_len = 64 },
            { name = "x", kind = "number", required = true },
            { name = "y", kind = "number", required = true },
            { name = "z", kind = "number", required = true },
            },
        },
        ["location.list"] = {
            params = {

            },
        },
        ["location.delete"] = {
            params = {
            { name = "name", kind = "string", required = true, max_len = 64 },
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
        ["data.collections"] = {
            params = {

            },
        },
        ["data.list"] = {
            params = {
            { name = "collection", kind = "string", required = true, max_len = 96 },
            },
        },
        ["data.get"] = {
            params = {
            { name = "collection", kind = "string", required = true, max_len = 96 },
            { name = "record", kind = "string", required = true, max_len = 128 },
            },
        },
        ["data.set"] = {
            params = {
            { name = "collection", kind = "string", required = true, max_len = 96 },
            { name = "record", kind = "string", required = true, max_len = 128 },
            },
        },
        ["data.delete"] = {
            params = {
            { name = "collection", kind = "string", required = true, max_len = 96 },
            { name = "record", kind = "string", required = true, max_len = 128 },
            },
        },
    },
}
