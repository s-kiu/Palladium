// Generated from packages/shared/bridge-capabilities.json — do not edit. Regenerate: node packages/shared/generate.mjs
window.PALLADIUM_STUDIO = {
  "version": "4.27.0",
  "capabilities": [
    {
      "type": "player.message",
      "group": "player",
      "summary": "Send a private system-chat message to one online player.",
      "scope": "write",
      "target": "player",
      "targetOptional": false,
      "params": {
        "text": {
          "type": "string",
          "required": true
        }
      }
    },
    {
      "type": "player.give_item",
      "group": "player",
      "summary": "Hand items to a player. The count is read before and after, so the result says whether they arrived: an unknown item id is reported as a failure rather than a success that added nothing.",
      "scope": "write",
      "target": "player",
      "targetOptional": false,
      "params": {
        "item": {
          "type": "item_id",
          "required": true
        },
        "count": {
          "type": "int",
          "required": false,
          "min": 1,
          "max": 9999,
          "default": 1
        }
      }
    },
    {
      "type": "player.teleport",
      "group": "player",
      "summary": "Move an online player. The destination is x/y/z coordinates, or another player: `to` names one and their position is the target — in chat, `!teleport to=@Name` is 'take me to them' and `!teleport @Name to=@me` is 'bring them here'. The result reports where they actually landed; a move that went nowhere is a failure, not a success.",
      "scope": "write",
      "target": "player",
      "targetOptional": false,
      "params": {
        "x": {
          "type": "number",
          "required": false
        },
        "y": {
          "type": "number",
          "required": false
        },
        "z": {
          "type": "number",
          "required": false
        },
        "to": {
          "type": "string",
          "required": false
        }
      }
    },
    {
      "type": "player.heal",
      "group": "player",
      "summary": "Restore an online player to full: HP back to maximum and a full stomach, shield included where the build exposes it. Reports which of the three actually moved, and why any of them did not.",
      "scope": "write",
      "target": "player",
      "targetOptional": false,
      "params": {}
    },
    {
      "type": "player.count_item",
      "group": "player",
      "summary": "How many of an item an online player carries. Money is the item id for gold.",
      "scope": "read",
      "target": "player",
      "targetOptional": false,
      "params": {
        "item": {
          "type": "item_id",
          "required": true
        }
      }
    },
    {
      "type": "player.has_item",
      "group": "player",
      "summary": "Whether an online player carries at least `count` of an item.",
      "scope": "read",
      "target": "player",
      "targetOptional": false,
      "params": {
        "item": {
          "type": "item_id",
          "required": true
        },
        "count": {
          "type": "int",
          "required": false,
          "min": 1,
          "max": 999999,
          "default": 1
        }
      }
    },
    {
      "type": "pal.spawn",
      "group": "pals",
      "summary": "Spawn a pal, at explicit coordinates or beside a target player. One of the two is required; with coordinates the pal is placed there and the result reports where it landed. Level, rarity and passive-skill traits apply on spawn. hostile=true additionally turns the new pal on the target player through pal.aggro and reports whether that took. Spawns are not part of the world save: a server restart removes them. The result carries the new pal's id.",
      "scope": "write",
      "target": "player",
      "targetOptional": true,
      "params": {
        "species": {
          "type": "item_id",
          "required": true
        },
        "level": {
          "type": "int",
          "required": false,
          "min": 1,
          "max": 100,
          "default": 10
        },
        "rare": {
          "type": "bool",
          "required": false,
          "default": false
        },
        "traits": {
          "type": "string",
          "required": false
        },
        "x": {
          "type": "number",
          "required": false
        },
        "y": {
          "type": "number",
          "required": false
        },
        "z": {
          "type": "number",
          "required": false
        },
        "hostile": {
          "type": "bool",
          "required": false,
          "default": false
        }
      }
    },
    {
      "type": "player.set_tag",
      "group": "player",
      "summary": "Attach a key/value to a player, kept by the agent across restarts. The persistence primitive for 'already got the kit', ranks, notes.",
      "scope": "write",
      "target": "player",
      "targetOptional": true,
      "params": {
        "key": {
          "type": "string",
          "required": true
        },
        "value": {
          "type": "string",
          "required": true
        }
      }
    },
    {
      "type": "player.get_tag",
      "group": "player",
      "summary": "Read one of a player's tags. ok with value null when the tag is unset.",
      "scope": "read",
      "target": "player",
      "targetOptional": true,
      "params": {
        "key": {
          "type": "string",
          "required": true
        }
      }
    },
    {
      "type": "player.delete_tag",
      "group": "player",
      "summary": "Remove a tag from a player.",
      "scope": "write",
      "target": "player",
      "targetOptional": true,
      "params": {
        "key": {
          "type": "string",
          "required": true
        }
      }
    },
    {
      "type": "server.announce",
      "group": "world",
      "summary": "Tell everyone online something, as system chat. The agent sends it to each player itself, so a mod in the game can announce without anything outside it.",
      "scope": "write",
      "target": "server",
      "targetOptional": false,
      "params": {
        "message": {
          "type": "string",
          "required": true
        }
      }
    },
    {
      "type": "permission.register",
      "group": "permissions",
      "summary": "A mod registers one permission node it owns, namespaced by its name, with a description and a default effect. Idempotent, and an operator's change to the default in permissions.config outranks it.",
      "scope": "write",
      "target": null,
      "targetOptional": false,
      "params": {
        "mod": {
          "type": "string",
          "required": true
        },
        "node": {
          "type": "string",
          "required": true
        },
        "description": {
          "type": "string",
          "required": false
        },
        "default": {
          "type": "string",
          "required": false
        }
      }
    },
    {
      "type": "permission.check",
      "group": "permissions",
      "summary": "May this player do this? Resolves user overrides, then groups by weight, then the default group, then the node's default; deny beats allow. Any parameter beyond `node` is taken as the call being asked about and matched against the winning entry's constraint — 'may spawn, but only Lamball' is one node plus a constraint.",
      "scope": "read",
      "target": "player",
      "targetOptional": true,
      "params": {
        "node": {
          "type": "string",
          "required": true
        },
        "target": {
          "type": "string",
          "required": false
        }
      }
    },
    {
      "type": "permission.grant",
      "group": "permissions",
      "summary": "Set a per-player override: allow or deny a node for this player, optionally constrained ({\"species\":{\"in\":[…]}}, {\"x\":{\"min\":0,\"max\":1000}}). Player overrides beat every group.",
      "scope": "write",
      "target": "player",
      "targetOptional": true,
      "params": {
        "node": {
          "type": "string",
          "required": true
        },
        "effect": {
          "type": "string",
          "required": false,
          "default": "allow"
        },
        "constraints": {
          "type": "json",
          "required": false
        },
        "until": {
          "type": "string",
          "required": false
        },
        "where": {
          "type": "string",
          "required": false
        }
      }
    },
    {
      "type": "permission.revoke",
      "group": "permissions",
      "summary": "Remove a per-player override, so groups decide again.",
      "scope": "write",
      "target": "player",
      "targetOptional": true,
      "params": {
        "node": {
          "type": "string",
          "required": true
        }
      }
    },
    {
      "type": "permission.nodes",
      "group": "permissions",
      "summary": "Every registered node, grouped by the mod that registered it, with defaults.",
      "scope": "read",
      "target": null,
      "targetOptional": false,
      "params": {}
    },
    {
      "type": "permission.player",
      "group": "permissions",
      "summary": "A player's permission state: their groups, their overrides, and their role tag.",
      "scope": "read",
      "target": "player",
      "targetOptional": true,
      "params": {}
    },
    {
      "type": "group.create",
      "group": "permissions",
      "summary": "Create a permission group. tag is the [ROLE] shown in chat when enabled; weight orders groups when a player has several (highest wins).",
      "scope": "write",
      "target": null,
      "targetOptional": false,
      "params": {
        "name": {
          "type": "item_id",
          "required": true
        },
        "tag": {
          "type": "string",
          "required": false
        },
        "weight": {
          "type": "int",
          "required": false,
          "min": 0,
          "max": 1000,
          "default": 0
        }
      }
    },
    {
      "type": "group.update",
      "group": "permissions",
      "summary": "Change a group's tag or weight.",
      "scope": "write",
      "target": null,
      "targetOptional": false,
      "params": {
        "name": {
          "type": "item_id",
          "required": true
        },
        "tag": {
          "type": "string",
          "required": false
        },
        "weight": {
          "type": "int",
          "required": false,
          "min": 0,
          "max": 1000,
          "default": 0
        }
      }
    },
    {
      "type": "group.delete",
      "group": "permissions",
      "summary": "Delete a group (the default group cannot be deleted).",
      "scope": "write",
      "target": null,
      "targetOptional": false,
      "params": {
        "name": {
          "type": "item_id",
          "required": true
        }
      }
    },
    {
      "type": "group.set_entry",
      "group": "permissions",
      "summary": "Set one node entry on a group: allow or deny, optionally constrained. Wildcards work ('chatshop.*', '*').",
      "scope": "write",
      "target": null,
      "targetOptional": false,
      "params": {
        "group": {
          "type": "item_id",
          "required": true
        },
        "node": {
          "type": "string",
          "required": true
        },
        "effect": {
          "type": "string",
          "required": false,
          "default": "allow"
        },
        "constraints": {
          "type": "json",
          "required": false
        },
        "until": {
          "type": "string",
          "required": false
        },
        "where": {
          "type": "string",
          "required": false
        }
      }
    },
    {
      "type": "group.remove_entry",
      "group": "permissions",
      "summary": "Remove a node entry from a group.",
      "scope": "write",
      "target": null,
      "targetOptional": false,
      "params": {
        "group": {
          "type": "item_id",
          "required": true
        },
        "node": {
          "type": "string",
          "required": true
        }
      }
    },
    {
      "type": "group.assign",
      "group": "permissions",
      "summary": "Put a player into a group.",
      "scope": "write",
      "target": "player",
      "targetOptional": true,
      "params": {
        "group": {
          "type": "item_id",
          "required": true
        }
      }
    },
    {
      "type": "group.unassign",
      "group": "permissions",
      "summary": "Take a player out of a group.",
      "scope": "write",
      "target": "player",
      "targetOptional": true,
      "params": {
        "group": {
          "type": "item_id",
          "required": true
        }
      }
    },
    {
      "type": "group.list",
      "group": "permissions",
      "summary": "All groups with their entries, weights, tags and member counts.",
      "scope": "read",
      "target": null,
      "targetOptional": false,
      "params": {}
    },
    {
      "type": "player.position",
      "group": "player",
      "summary": "The online player's exact world position (Engine Actor location, includes z).",
      "scope": "read",
      "target": "player",
      "targetOptional": false,
      "params": {}
    },
    {
      "type": "location.save",
      "group": "world",
      "summary": "Save a named world location for the teleport picker. Stand somewhere, read player.position, save it — fast-travel points, arenas, meeting spots.",
      "scope": "write",
      "target": null,
      "targetOptional": false,
      "params": {
        "name": {
          "type": "string",
          "required": true
        },
        "x": {
          "type": "number",
          "required": true
        },
        "y": {
          "type": "number",
          "required": true
        },
        "z": {
          "type": "number",
          "required": true
        }
      }
    },
    {
      "type": "location.list",
      "group": "world",
      "summary": "Saved locations plus boss-spawn positions observed live (source: manual | boss).",
      "scope": "read",
      "target": null,
      "targetOptional": false,
      "params": {}
    },
    {
      "type": "location.delete",
      "group": "world",
      "summary": "Remove a saved location.",
      "scope": "write",
      "target": null,
      "targetOptional": false,
      "params": {
        "name": {
          "type": "string",
          "required": true
        }
      }
    },
    {
      "type": "pal.list",
      "group": "pals",
      "summary": "Pals currently loaded in the world (players excluded), with species, level and — when the engine exposes it — a stable id usable as a pal.set_hp target. Capped at 100 rows; count reports the true total.",
      "scope": "read",
      "target": null,
      "targetOptional": false,
      "params": {}
    },
    {
      "type": "player.stats",
      "group": "player",
      "summary": "Read an online player's stats — hp/maxHp, hunger/maxHunger, shield/maxShield, sanity, plus level, rank, talent* IVs and rank* soul upgrades from the save parameter. A stat this build does not expose comes back null rather than absent.",
      "scope": "read",
      "target": "player",
      "targetOptional": false,
      "params": {}
    },
    {
      "type": "player.set_stats",
      "group": "player",
      "summary": "Set any combination of an online player's stats in one call; omitted fields are left alone. Values are absolute, on the same scale player.stats reports — hp is converted to the rate the engine wants using the maximum it reports; asking for more HP than the maximum raises the maximum with it. Combat and work stats (level, rank, talent* IVs, rank* soul upgrades) are written to the save parameter and replicated — they are pal stats, and a player character is refused them rather than told they applied (player.status_point is the equivalent). Every write is read back: applied lists what changed, unverified what the engine accepted without visibly changing, failed what it refused.",
      "scope": "write",
      "target": "player",
      "targetOptional": false,
      "params": {
        "hp": {
          "type": "number",
          "required": false,
          "min": 0,
          "max": 100000000
        },
        "maxHp": {
          "type": "number",
          "required": false,
          "min": 1,
          "max": 100000000
        },
        "hunger": {
          "type": "number",
          "required": false,
          "min": 0,
          "max": 1000
        },
        "shield": {
          "type": "number",
          "required": false,
          "min": 0,
          "max": 100000
        },
        "maxShield": {
          "type": "number",
          "required": false,
          "min": 1,
          "max": 100000
        },
        "level": {
          "type": "int",
          "required": false,
          "min": 1,
          "max": 100
        },
        "rank": {
          "type": "int",
          "required": false,
          "min": 1,
          "max": 5
        },
        "talentHp": {
          "type": "int",
          "required": false,
          "min": 0,
          "max": 100
        },
        "talentMelee": {
          "type": "int",
          "required": false,
          "min": 0,
          "max": 100
        },
        "talentShot": {
          "type": "int",
          "required": false,
          "min": 0,
          "max": 100
        },
        "talentDefense": {
          "type": "int",
          "required": false,
          "min": 0,
          "max": 100
        },
        "rankAttack": {
          "type": "int",
          "required": false,
          "min": 0,
          "max": 10
        },
        "rankDefence": {
          "type": "int",
          "required": false,
          "min": 0,
          "max": 10
        },
        "rankCraftSpeed": {
          "type": "int",
          "required": false,
          "min": 0,
          "max": 10
        }
      }
    },
    {
      "type": "player.set_immortal",
      "group": "",
      "summary": "Make a player unkillable, or mortal again. Raises DefenseUp so almost nothing gets through, and refills health and stomach on the agent's tick as a backstop; their own defence is remembered and handed back. Stamina is deliberately untouched — the client draws that bar from its own simulation, so a server-side refill only fights it.",
      "scope": "write",
      "target": "player",
      "targetOptional": false,
      "params": {
        "on": {
          "type": "bool",
          "required": false,
          "default": true
        }
      }
    },
    {
      "type": "player.set_frozen",
      "group": "",
      "summary": "Hold a player still, or let them go. Movement is simulated on the player's own machine, so a server-side speed of zero does not stop them; the agent anchors them instead and puts them back when they move more than a step. Enforcement rather than prevention: a frozen player can take that step before being returned.",
      "scope": "write",
      "target": "player",
      "targetOptional": false,
      "params": {
        "on": {
          "type": "bool",
          "required": false,
          "default": true
        }
      }
    },
    {
      "type": "player.set_flying",
      "group": "",
      "summary": "Ask a player's game to start or end flight. The server cannot fly a player on its own — flight is a mode the client enters — so this sends an instruction the optional AdminControlsClient mod acts on. Unverified by design: nothing reports flight back, and without the client mod installed nothing happens.",
      "scope": "write",
      "target": "player",
      "targetOptional": false,
      "params": {
        "on": {
          "type": "bool",
          "required": false,
          "default": true
        }
      }
    },
    {
      "type": "player.status_points",
      "group": "player",
      "summary": "An online player's status points — the allocation the game computes their max HP, stamina, attack and carry weight from. Names are the game's own; the ones this build answers for are what comes back.",
      "scope": "read",
      "target": "player",
      "targetOptional": false,
      "params": {}
    },
    {
      "type": "player.status_point",
      "group": "player",
      "summary": "Spend status points on one of a player's stats, the way a level-up does. This is how a player's max HP goes up: it is computed from the points, not stored, so nothing else can raise it. Additive. stat is the game's own FName for the stat and is passed through verbatim — this build spends through the player controller and exposes no way to read the allocation back, so the result reports which readable stat moved instead. player.status_points lists the names to try.",
      "scope": "write",
      "target": "player",
      "targetOptional": false,
      "params": {
        "stat": {
          "type": "string",
          "required": true
        },
        "points": {
          "type": "int",
          "required": false,
          "min": 1,
          "max": 1000,
          "default": 1
        }
      }
    },
    {
      "type": "player.playtime",
      "group": "player",
      "summary": "Minutes a player has actually spent on this server, credited one minute at a time while they are online — a crash costs at most the minute in progress. Also reports the current session's minutes and whether they are online right now. Answers for offline players too: the total is history, not presence.",
      "scope": "read",
      "target": "player",
      "targetOptional": true,
      "params": {}
    },
    {
      "type": "player.records",
      "group": "player",
      "summary": "A player's lifetime tallies — pals captured, Paldex entries unlocked, bosses beaten, areas found, fish caught, items crafted. Read from the record the game keeps per player rather than from their body, so it answers for offline players too. bosses is every kind summed, since the game counts normal, tower, raid and predator separately; records carries those apart, along with butchered, rankups and mutations. Each headline counter is a plain field for mods with no JSON parser, and a counter this build does not expose reads 0.",
      "scope": "read",
      "target": "player",
      "targetOptional": true,
      "params": {}
    },
    {
      "type": "pal.stats",
      "group": "pals",
      "summary": "Read a loaded pal's stats, targeting the id from pal.list or a pal.spawn result — including level, rank, talent* IVs and rank* soul upgrades.",
      "scope": "read",
      "target": null,
      "targetOptional": false,
      "params": {
        "pal": {
          "type": "string",
          "required": true
        }
      }
    },
    {
      "type": "pal.set_stats",
      "group": "pals",
      "summary": "Set any combination of a loaded pal's stats in one call; omitted fields are left alone. Values are absolute, on the same scale pal.stats reports — hp is converted to the rate the engine wants using the maximum it reports; asking for more HP than the maximum raises the maximum with it. Combat and work stats (level, rank, talent* IVs, rank* soul upgrades) are written to the save parameter and replicated — they are pal stats, and a player character is refused them rather than told they applied (player.status_point is the equivalent). Every write is read back: applied lists what changed, unverified what the engine accepted without visibly changing, failed what it refused.",
      "scope": "write",
      "target": null,
      "targetOptional": false,
      "params": {
        "pal": {
          "type": "string",
          "required": true
        },
        "hp": {
          "type": "number",
          "required": false,
          "min": 0,
          "max": 100000000
        },
        "maxHp": {
          "type": "number",
          "required": false,
          "min": 1,
          "max": 100000000
        },
        "hunger": {
          "type": "number",
          "required": false,
          "min": 0,
          "max": 1000
        },
        "shield": {
          "type": "number",
          "required": false,
          "min": 0,
          "max": 100000
        },
        "maxShield": {
          "type": "number",
          "required": false,
          "min": 1,
          "max": 100000
        },
        "level": {
          "type": "int",
          "required": false,
          "min": 1,
          "max": 100
        },
        "rank": {
          "type": "int",
          "required": false,
          "min": 1,
          "max": 5
        },
        "talentHp": {
          "type": "int",
          "required": false,
          "min": 0,
          "max": 100
        },
        "talentMelee": {
          "type": "int",
          "required": false,
          "min": 0,
          "max": 100
        },
        "talentShot": {
          "type": "int",
          "required": false,
          "min": 0,
          "max": 100
        },
        "talentDefense": {
          "type": "int",
          "required": false,
          "min": 0,
          "max": 100
        },
        "rankAttack": {
          "type": "int",
          "required": false,
          "min": 0,
          "max": 10
        },
        "rankDefence": {
          "type": "int",
          "required": false,
          "min": 0,
          "max": 10
        },
        "rankCraftSpeed": {
          "type": "int",
          "required": false,
          "min": 0,
          "max": 10
        }
      }
    },
    {
      "type": "pal.aggro",
      "group": "pals",
      "summary": "Make a loaded pal hate a player, so it turns on them and fights. The hate system itself is not callable on this build, so the pal, its controller and its parameter component are searched for a hate function that is, and the engine's own damage path is the last resort. The result names the call that worked; a failure lists the hate-related functions this build does expose. sight=true additionally flips the pal's sensor temperament to attack-on-sight — it then goes for anyone who comes close, not only the caller.",
      "scope": "write",
      "target": "player",
      "targetOptional": false,
      "params": {
        "pal": {
          "type": "string",
          "required": true
        },
        "amount": {
          "type": "int",
          "required": false,
          "min": 1,
          "max": 100000,
          "default": 1000
        },
        "sight": {
          "type": "bool",
          "required": false,
          "default": false
        }
      }
    },
    {
      "type": "pal.inspect",
      "group": "pals",
      "summary": "Diagnostic dump for one loaded pal: its AI controller class, whether a player owns it, otomo flag, spawned type, and whether a hate system exists on it (which is not the same as it hating anyone). Run it on a wild pal and on a spawned one — the difference is why one fights back and the other does not.",
      "scope": "read",
      "target": null,
      "targetOptional": false,
      "params": {
        "pal": {
          "type": "string",
          "required": true
        }
      }
    },
    {
      "type": "pal.spawn_wild",
      "group": "pals",
      "summary": "Spawn a real wild pal: one of the world's own spawners near the player fires, so the game itself wires the newcomer — controller, wild group, combat permission. With a species, the spawner's lottery is rewritten for the shot and restored right after; aggressive=true also sets the newcomer's temperament to attack-on-sight. Without a species the spawner rolls its own table; kind=boss prefers an alpha spawner. Contrast pal.spawn, which places a hand-made pal at exact coordinates but outside the world's own wiring.",
      "scope": "write",
      "target": "player",
      "targetOptional": false,
      "params": {
        "species": {
          "type": "item_id",
          "required": false
        },
        "level": {
          "type": "int",
          "required": false,
          "min": 1,
          "max": 100,
          "default": 15
        },
        "aggressive": {
          "type": "bool",
          "required": false,
          "default": false
        },
        "kind": {
          "type": "string",
          "required": false,
          "default": "nearest"
        },
        "radius": {
          "type": "number",
          "required": false,
          "min": 0,
          "max": 1000000,
          "default": 50000
        }
      }
    },
    {
      "type": "pal.force_spawn",
      "group": "pals",
      "summary": "Deprecated alias of pal.spawn_wild — same behavior, kept so existing scripts keep working.",
      "scope": "write",
      "target": "player",
      "targetOptional": false,
      "params": {
        "species": {
          "type": "item_id",
          "required": false
        },
        "level": {
          "type": "int",
          "required": false,
          "min": 1,
          "max": 100,
          "default": 15
        },
        "aggressive": {
          "type": "bool",
          "required": false,
          "default": false
        },
        "kind": {
          "type": "string",
          "required": false,
          "default": "nearest"
        },
        "radius": {
          "type": "number",
          "required": false,
          "min": 0,
          "max": 1000000,
          "default": 50000
        }
      }
    },
    {
      "type": "bridge.probe",
      "group": "agent",
      "summary": "Which engine functions and properties this build actually exposes on an object, narrowed by substring. Reads the class chain through reflection and calls nothing, so it is safe to point anywhere. This is the answer to a not_supported: it names what does exist, fields included — a value the engine keeps in a property rather than behind a getter is invisible to a function list alone. on: player | state | controller | params | pal | palai | palparams | utility | manager | spawner, or class:<UClassName> for any live object by its class.",
      "scope": "read",
      "target": "player",
      "targetOptional": true,
      "params": {
        "on": {
          "type": "string",
          "required": false,
          "default": "player"
        },
        "pal": {
          "type": "string",
          "required": false
        },
        "filter": {
          "type": "string",
          "required": false
        }
      }
    },
    {
      "type": "data.collections",
      "group": "world",
      "summary": "Every collection the agent and its mods have declared, with its owner, storage class and field shape — enough to render one this caller has never heard of.",
      "scope": "read",
      "target": null,
      "targetOptional": false,
      "params": {}
    },
    {
      "type": "data.list",
      "group": "world",
      "summary": "Every record in one collection, by its qualified name (owner.name).",
      "scope": "read",
      "target": null,
      "targetOptional": false,
      "params": {
        "collection": {
          "type": "string",
          "required": true
        }
      }
    },
    {
      "type": "data.get",
      "group": "world",
      "summary": "One record from a collection. ok with record null when it is not there.",
      "scope": "read",
      "target": null,
      "targetOptional": false,
      "params": {
        "collection": {
          "type": "string",
          "required": true
        },
        "record": {
          "type": "string",
          "required": true
        }
      }
    },
    {
      "type": "data.set",
      "group": "world",
      "summary": "Write one record. Every parameter beyond collection and record becomes a field on it, so the call carries the shape the collection declared. List-valued fields cannot be set this way yet.",
      "scope": "write",
      "target": null,
      "targetOptional": false,
      "params": {
        "collection": {
          "type": "string",
          "required": true
        },
        "record": {
          "type": "string",
          "required": true
        }
      }
    },
    {
      "type": "data.delete",
      "group": "world",
      "summary": "Remove one record from a collection.",
      "scope": "write",
      "target": null,
      "targetOptional": false,
      "params": {
        "collection": {
          "type": "string",
          "required": true
        },
        "record": {
          "type": "string",
          "required": true
        }
      }
    }
  ],
  "events": [
    {
      "type": "bridge.ready",
      "summary": "The in-game agent loaded. Carries its version and the actions it can execute; its absence is what 'no bridge' means."
    },
    {
      "type": "bridge.hook",
      "summary": "One per engine hook the agent tried to register, reporting whether it is live. A failed hook costs its event type and nothing else."
    },
    {
      "type": "player.chat",
      "summary": "A player sent a chat message. The text is untrusted input, capped at 512 characters."
    },
    {
      "type": "player.join",
      "summary": "A player's character finished initialising after connecting. firstEver, firstSeen and joins come from the agent's own registry, which outlives the event file."
    },
    {
      "type": "player.respawn",
      "summary": "A player's character re-initialised right after a death — a respawn, not a join. Heuristic: only emitted when the same player died since their last event."
    },
    {
      "type": "player.death",
      "summary": "A player died. Pals dying are not reported. killer is a full subject when another player did it; attribution is best-effort."
    },
    {
      "type": "player.leave",
      "summary": "A player disconnected. No hookable disconnect exists on this loader, so the agent notices by watching who is still in the world and reports it within a few seconds rather than instantly."
    },
    {
      "type": "npc.spawn",
      "summary": "A pal/NPC finished parameter initialisation — fires on world spawns near players. Player characters are filtered out. Throttled to 20 events per second."
    },
    {
      "type": "player.hour",
      "summary": "A player's counted playtime just completed another full hour. Fired by the same minute-ticker that credits playtime, so it lands within a minute of the boundary and only while they are online. Carries the new hour total and the exact minute count."
    },
    {
      "type": "clock.minute",
      "summary": "The wall-clock minute turned, in server-local time. The event mods schedule real-world things against — a weekday, hour and minute comparison replaces owning a timer. Published within two seconds of the minute boundary."
    },
    {
      "type": "clock.day",
      "summary": "The date turned, in server-local time — published at the first minute of the new day. A boot mid-day is not a turn. The event daily things schedule against without stamp arithmetic."
    },
    {
      "type": "player.item_use",
      "summary": "A player used an item through the use-on-character path — feeding and healing pals, and eating from their own inventory, all fire it (verified live). The slot and count are known; resolving which item sat in the slot, and the target, is future work."
    }
  ]
};
