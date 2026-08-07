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
            scope = "write",
            params = {
            { name = "text", kind = "string", required = true, max_len = 512 },
            },
        },
        ["player.give_item"] = {
            target = "player",
            scope = "write",
            params = {
            { name = "item", kind = "item_id", required = true },
            { name = "count", kind = "int", min = 1, max = 9999, default = 1 },
            },
        },
        ["player.teleport"] = {
            target = "player",
            scope = "write",
            params = {
            { name = "x", kind = "number", required = true },
            { name = "y", kind = "number", required = true },
            { name = "z", kind = "number", required = true },
            },
        },
        ["player.heal"] = {
            target = "player",
            scope = "write",
            params = {

            },
        },
        ["player.count_item"] = {
            target = "player",
            scope = "read",
            params = {
            { name = "item", kind = "item_id", required = true },
            },
        },
        ["player.has_item"] = {
            target = "player",
            scope = "read",
            params = {
            { name = "item", kind = "item_id", required = true },
            { name = "count", kind = "int", min = 1, max = 999999, default = 1 },
            },
        },
        ["pal.spawn"] = {
            target = "player",
            target_optional = true,
            scope = "write",
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
            scope = "write",
            params = {
            { name = "key", kind = "string", required = true, max_len = 64 },
            { name = "value", kind = "string", required = true, max_len = 512 },
            },
        },
        ["player.get_tag"] = {
            target = "player",
            target_optional = true,
            scope = "read",
            params = {
            { name = "key", kind = "string", required = true, max_len = 64 },
            },
        },
        ["player.delete_tag"] = {
            target = "player",
            target_optional = true,
            scope = "write",
            params = {
            { name = "key", kind = "string", required = true, max_len = 64 },
            },
        },
        ["server.announce"] = {
            target = "server",
            scope = "write",
            params = {
            { name = "message", kind = "string", required = true, max_len = 512 },
            },
        },
        ["permission.register"] = {
            scope = "write",
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
            scope = "read",
            params = {
            { name = "node", kind = "string", required = true, max_len = 128 },
            { name = "target", kind = "string", max_len = 64 },
            },
        },
        ["permission.grant"] = {
            target = "player",
            target_optional = true,
            scope = "write",
            params = {
            { name = "node", kind = "string", required = true, max_len = 128 },
            { name = "effect", kind = "string", max_len = 8, default = "allow" },
            { name = "constraints", kind = "json" },
            { name = "until", kind = "string", max_len = 20 },
            { name = "where", kind = "string", max_len = 200 },
            },
        },
        ["permission.revoke"] = {
            target = "player",
            target_optional = true,
            scope = "write",
            params = {
            { name = "node", kind = "string", required = true, max_len = 128 },
            },
        },
        ["permission.nodes"] = {
            scope = "read",
            params = {

            },
        },
        ["permission.player"] = {
            target = "player",
            target_optional = true,
            scope = "read",
            params = {

            },
        },
        ["group.create"] = {
            scope = "write",
            params = {
            { name = "name", kind = "item_id", required = true },
            { name = "tag", kind = "string", max_len = 16 },
            { name = "weight", kind = "int", min = 0, max = 1000, default = 0 },
            },
        },
        ["group.update"] = {
            scope = "write",
            params = {
            { name = "name", kind = "item_id", required = true },
            { name = "tag", kind = "string", max_len = 16 },
            { name = "weight", kind = "int", min = 0, max = 1000, default = 0 },
            },
        },
        ["group.delete"] = {
            scope = "write",
            params = {
            { name = "name", kind = "item_id", required = true },
            },
        },
        ["group.set_entry"] = {
            scope = "write",
            params = {
            { name = "group", kind = "item_id", required = true },
            { name = "node", kind = "string", required = true, max_len = 128 },
            { name = "effect", kind = "string", max_len = 8, default = "allow" },
            { name = "constraints", kind = "json" },
            { name = "until", kind = "string", max_len = 20 },
            { name = "where", kind = "string", max_len = 200 },
            },
        },
        ["group.remove_entry"] = {
            scope = "write",
            params = {
            { name = "group", kind = "item_id", required = true },
            { name = "node", kind = "string", required = true, max_len = 128 },
            },
        },
        ["group.assign"] = {
            target = "player",
            target_optional = true,
            scope = "write",
            params = {
            { name = "group", kind = "item_id", required = true },
            },
        },
        ["group.unassign"] = {
            target = "player",
            target_optional = true,
            scope = "write",
            params = {
            { name = "group", kind = "item_id", required = true },
            },
        },
        ["group.list"] = {
            scope = "read",
            params = {

            },
        },
        ["player.position"] = {
            target = "player",
            scope = "read",
            params = {

            },
        },
        ["location.save"] = {
            scope = "write",
            params = {
            { name = "name", kind = "string", required = true, max_len = 64 },
            { name = "x", kind = "number", required = true },
            { name = "y", kind = "number", required = true },
            { name = "z", kind = "number", required = true },
            },
        },
        ["location.list"] = {
            scope = "read",
            params = {

            },
        },
        ["location.delete"] = {
            scope = "write",
            params = {
            { name = "name", kind = "string", required = true, max_len = 64 },
            },
        },
        ["pal.list"] = {
            scope = "read",
            params = {

            },
        },
        ["player.stats"] = {
            target = "player",
            scope = "read",
            params = {

            },
        },
        ["player.set_stats"] = {
            target = "player",
            scope = "write",
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
            scope = "read",
            params = {

            },
        },
        ["player.status_point"] = {
            target = "player",
            scope = "write",
            params = {
            { name = "stat", kind = "string", required = true, max_len = 32 },
            { name = "points", kind = "int", min = 1, max = 1000, default = 1 },
            },
        },
        ["player.playtime"] = {
            target = "player",
            target_optional = true,
            scope = "read",
            params = {

            },
        },
        ["pal.stats"] = {
            scope = "read",
            params = {
            { name = "pal", kind = "string", required = true, max_len = 64 },
            },
        },
        ["pal.set_stats"] = {
            scope = "write",
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
            scope = "write",
            params = {
            { name = "pal", kind = "string", required = true, max_len = 64 },
            { name = "amount", kind = "int", min = 1, max = 100000, default = 1000 },
            { name = "sight", kind = "bool", default = false },
            },
        },
        ["pal.inspect"] = {
            scope = "read",
            params = {
            { name = "pal", kind = "string", required = true, max_len = 64 },
            },
        },
        ["pal.force_spawn"] = {
            target = "player",
            scope = "write",
            params = {
            { name = "species", kind = "item_id" },
            { name = "level", kind = "int", min = 1, max = 100, default = 15 },
            { name = "aggressive", kind = "bool", default = false },
            { name = "kind", kind = "string", max_len = 16, default = "nearest" },
            { name = "radius", kind = "number", min = 0, max = 1000000, default = 50000 },
            },
        },
        ["bridge.probe"] = {
            target = "player",
            target_optional = true,
            scope = "read",
            params = {
            { name = "on", kind = "string", max_len = 64, default = "player" },
            { name = "pal", kind = "string", max_len = 64 },
            { name = "filter", kind = "string", max_len = 32 },
            },
        },
        ["data.collections"] = {
            scope = "read",
            params = {

            },
        },
        ["data.list"] = {
            scope = "read",
            params = {
            { name = "collection", kind = "string", required = true, max_len = 96 },
            },
        },
        ["data.get"] = {
            scope = "read",
            params = {
            { name = "collection", kind = "string", required = true, max_len = 96 },
            { name = "record", kind = "string", required = true, max_len = 128 },
            },
        },
        ["data.set"] = {
            scope = "write",
            params = {
            { name = "collection", kind = "string", required = true, max_len = 96 },
            { name = "record", kind = "string", required = true, max_len = 128 },
            },
        },
        ["data.delete"] = {
            scope = "write",
            params = {
            { name = "collection", kind = "string", required = true, max_len = 96 },
            { name = "record", kind = "string", required = true, max_len = 128 },
            },
        },
    },
}
