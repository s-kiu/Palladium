// Generated from packages/shared/bridge-capabilities.json — do not edit. Regenerate: node packages/shared/generate.mjs
export type ParamType = 'string' | 'int' | 'number' | 'bool' | 'item_id' | 'subject' | 'json';

export interface ParamSpec {
  type: ParamType;
  required?: boolean;
  picker?: string;
  optional?: boolean;
  enriched?: boolean;
  min?: number;
  max?: number;
  maxLen?: number;
  default?: string | number | boolean;
}

export interface Capability {
  type: string;
  kind: 'event' | 'action' | 'query';
  runtime: 'agent' | 'daemon' | 'game-rest';
  subject?: string;
  target?: string;
  source?: { hook: string };
  since: string;
  stability: 'stable' | 'experimental' | 'deprecated';
  scope: 'read' | 'write';
  summary: string;
  params?: Record<string, ParamSpec>;
  data?: Record<string, ParamSpec>;
  returns?: Record<string, string>;
  errors?: string[];
}

export const ENVELOPE_VERSION = 2;

export const CAPABILITIES: Capability[] = [
  {
    "type": "bridge.ready",
    "kind": "event",
    "runtime": "agent",
    "subject": "bridge",
    "since": "2.0.0",
    "stability": "stable",
    "scope": "read",
    "summary": "The in-game agent loaded. Carries its version and the actions it can execute; its absence is what 'no bridge' means.",
    "data": {
      "agent": {
        "type": "string"
      },
      "version": {
        "type": "string"
      },
      "envelope": {
        "type": "int"
      }
    }
  },
  {
    "type": "bridge.hook",
    "kind": "event",
    "runtime": "agent",
    "subject": "bridge",
    "since": "2.0.0",
    "stability": "stable",
    "scope": "read",
    "summary": "One per engine hook the agent tried to register, reporting whether it is live. A failed hook costs its event type and nothing else.",
    "data": {
      "hook": {
        "type": "string"
      },
      "target": {
        "type": "string"
      },
      "ok": {
        "type": "bool"
      }
    }
  },
  {
    "type": "player.chat",
    "kind": "event",
    "runtime": "agent",
    "source": {
      "hook": "/Script/Pal.PalPlayerController:EnterChat_Receive"
    },
    "subject": "player",
    "since": "1.0.0",
    "stability": "stable",
    "scope": "read",
    "summary": "A player sent a chat message. The text is untrusted input, capped at 512 characters.",
    "data": {
      "message": {
        "type": "string"
      }
    }
  },
  {
    "type": "player.join",
    "kind": "event",
    "runtime": "agent",
    "source": {
      "hook": "/Script/Pal.PalPlayerCharacter:OnCompleteInitializeParameter"
    },
    "subject": "player",
    "since": "1.1.0",
    "stability": "stable",
    "summary": "A player's character finished initialising after connecting. firstEver/joins/firstSeen are enriched by the daemon from its database and are present on the HTTP door only.",
    "scope": "read",
    "data": {
      "firstThisRun": {
        "type": "bool"
      },
      "firstEver": {
        "type": "bool",
        "enriched": true
      },
      "firstSeen": {
        "type": "int",
        "enriched": true
      },
      "joins": {
        "type": "int",
        "enriched": true
      }
    }
  },
  {
    "type": "player.respawn",
    "kind": "event",
    "runtime": "agent",
    "source": {
      "hook": "/Script/Pal.PalPlayerCharacter:OnCompleteInitializeParameter"
    },
    "subject": "player",
    "since": "2.0.0",
    "stability": "experimental",
    "scope": "read",
    "summary": "A player's character re-initialised right after a death — a respawn, not a join. Heuristic: only emitted when the same player died since their last event.",
    "data": {}
  },
  {
    "type": "player.death",
    "kind": "event",
    "runtime": "agent",
    "source": {
      "hook": "/Script/Pal.PalCharacter:OnDeadCharacter"
    },
    "subject": "player",
    "since": "1.1.0",
    "stability": "stable",
    "scope": "read",
    "summary": "A player died. Pals dying are not reported. killer is a full subject when another player did it; attribution is best-effort.",
    "data": {
      "killer": {
        "type": "subject",
        "optional": true
      }
    }
  },
  {
    "type": "player.leave",
    "kind": "event",
    "runtime": "daemon",
    "subject": "player",
    "since": "1.1.0",
    "stability": "stable",
    "scope": "read",
    "summary": "A player disconnected. Derived from the game's REST player list (no hookable disconnect exists on this loader), so it arrives within a few seconds rather than instantly.",
    "data": {
      "source": {
        "type": "string"
      }
    }
  },
  {
    "type": "npc.spawn",
    "kind": "event",
    "runtime": "agent",
    "source": {
      "hook": "/Script/Pal.PalCharacterParameterComponent:OnInitialize_AfterSetIndividualParameter"
    },
    "subject": "pal",
    "since": "2.0.0",
    "stability": "experimental",
    "scope": "read",
    "summary": "A pal/NPC finished parameter initialisation — fires on world spawns near players. Player characters are filtered out. Throttled to 20 events per second.",
    "data": {
      "species": {
        "type": "string"
      },
      "level": {
        "type": "int"
      },
      "rare": {
        "type": "bool"
      }
    }
  },
  {
    "type": "player.message",
    "kind": "action",
    "runtime": "agent",
    "target": "player",
    "since": "1.1.0",
    "stability": "stable",
    "scope": "write",
    "summary": "Send a private system-chat message to one online player.",
    "params": {
      "text": {
        "type": "string",
        "required": true,
        "maxLen": 512
      }
    },
    "returns": {},
    "errors": [
      "player_offline",
      "invalid_params"
    ]
  },
  {
    "type": "player.give_item",
    "kind": "action",
    "runtime": "agent",
    "target": "player",
    "since": "1.1.0",
    "stability": "stable",
    "scope": "write",
    "summary": "Put items into an online player's inventory. Item ids are the game's internal names (bread is Pan); an unknown id is accepted by the game and silently does nothing.",
    "params": {
      "item": {
        "type": "item_id",
        "required": true,
        "picker": "item"
      },
      "count": {
        "type": "int",
        "min": 1,
        "max": 9999,
        "default": 1
      }
    },
    "returns": {
      "item": "item_id",
      "count": "int"
    },
    "errors": [
      "player_offline",
      "invalid_params"
    ]
  },
  {
    "type": "player.teleport",
    "kind": "action",
    "runtime": "agent",
    "target": "player",
    "since": "2.0.0",
    "stability": "experimental",
    "scope": "write",
    "summary": "Teleport an online player to world coordinates (Engine Actor K2_TeleportTo).",
    "params": {
      "x": {
        "type": "number",
        "required": true,
        "picker": "location"
      },
      "y": {
        "type": "number",
        "required": true
      },
      "z": {
        "type": "number",
        "required": true
      }
    },
    "returns": {
      "x": "number",
      "y": "number",
      "z": "number"
    },
    "errors": [
      "player_offline",
      "invalid_params",
      "not_supported"
    ]
  },
  {
    "type": "player.heal",
    "kind": "action",
    "runtime": "agent",
    "target": "player",
    "since": "2.0.0",
    "stability": "experimental",
    "scope": "write",
    "summary": "Fully restore an online player's HP (PalUtility FullRecoveryHP).",
    "params": {},
    "returns": {},
    "errors": [
      "player_offline",
      "not_supported"
    ]
  },
  {
    "type": "player.count_item",
    "kind": "query",
    "runtime": "agent",
    "target": "player",
    "since": "2.0.0",
    "stability": "experimental",
    "scope": "read",
    "summary": "How many of an item an online player carries. Money is the item id for gold.",
    "params": {
      "item": {
        "type": "item_id",
        "required": true,
        "picker": "item"
      }
    },
    "returns": {
      "item": "item_id",
      "count": "int"
    },
    "errors": [
      "player_offline",
      "invalid_params",
      "not_supported"
    ]
  },
  {
    "type": "player.has_item",
    "kind": "query",
    "runtime": "agent",
    "target": "player",
    "since": "2.0.0",
    "stability": "experimental",
    "scope": "read",
    "summary": "Whether an online player carries at least `count` of an item.",
    "params": {
      "item": {
        "type": "item_id",
        "required": true,
        "picker": "item"
      },
      "count": {
        "type": "int",
        "min": 1,
        "max": 999999,
        "default": 1
      }
    },
    "returns": {
      "item": "item_id",
      "has": "bool",
      "count": "int"
    },
    "errors": [
      "player_offline",
      "invalid_params",
      "not_supported"
    ]
  },
  {
    "type": "pal.spawn",
    "kind": "action",
    "runtime": "agent",
    "target": "player",
    "since": "2.0.0",
    "stability": "experimental",
    "scope": "write",
    "summary": "Spawn a pal near the target player (or at explicit coordinates), with level, rarity and passive-skill traits. Spawned pals use the base NPC AI: they do not attack and do not fight back — use pal.aggro to make one target a player. hostile=true asks for a combat AI controller class if this build exposes one (most do not) and reports which controller applied. Spawns are not part of the world save: a server restart removes them. The result carries the new pal's id.",
    "params": {
      "species": {
        "type": "item_id",
        "required": true,
        "picker": "pal"
      },
      "level": {
        "type": "int",
        "min": 1,
        "max": 100,
        "default": 10
      },
      "rare": {
        "type": "bool",
        "default": false
      },
      "traits": {
        "type": "string",
        "maxLen": 200,
        "picker": "traits"
      },
      "x": {
        "type": "number"
      },
      "y": {
        "type": "number"
      },
      "z": {
        "type": "number"
      },
      "hostile": {
        "type": "bool",
        "default": false
      }
    },
    "returns": {
      "pal": "string",
      "species": "item_id",
      "level": "int",
      "hostile": "bool",
      "controller": "string"
    },
    "errors": [
      "player_offline",
      "invalid_params",
      "spawn_failed"
    ]
  },
  {
    "type": "player.set_tag",
    "kind": "action",
    "runtime": "daemon",
    "target": "player",
    "since": "2.0.0",
    "stability": "stable",
    "scope": "write",
    "summary": "Attach a key/value to a player, kept in the daemon's database across restarts. The persistence primitive for 'already got the kit', ranks, notes.",
    "params": {
      "key": {
        "type": "string",
        "required": true,
        "maxLen": 64
      },
      "value": {
        "type": "string",
        "required": true,
        "maxLen": 512
      }
    },
    "returns": {
      "key": "string",
      "value": "string"
    },
    "errors": [
      "unknown_player",
      "invalid_params"
    ]
  },
  {
    "type": "player.get_tag",
    "kind": "query",
    "runtime": "daemon",
    "target": "player",
    "since": "2.0.0",
    "stability": "stable",
    "scope": "read",
    "summary": "Read one of a player's tags. ok with value null when the tag is unset.",
    "params": {
      "key": {
        "type": "string",
        "required": true,
        "maxLen": 64
      }
    },
    "returns": {
      "key": "string",
      "value": "string|null"
    },
    "errors": [
      "invalid_params"
    ]
  },
  {
    "type": "player.delete_tag",
    "kind": "action",
    "runtime": "daemon",
    "target": "player",
    "since": "2.0.0",
    "stability": "stable",
    "scope": "write",
    "summary": "Remove a tag from a player.",
    "params": {
      "key": {
        "type": "string",
        "required": true,
        "maxLen": 64
      }
    },
    "returns": {
      "key": "string"
    },
    "errors": [
      "invalid_params"
    ]
  },
  {
    "type": "server.announce",
    "kind": "action",
    "runtime": "game-rest",
    "target": "server",
    "since": "1.0.0",
    "stability": "stable",
    "scope": "write",
    "summary": "Broadcast a message to everyone online, via the game's own REST API.",
    "params": {
      "message": {
        "type": "string",
        "required": true,
        "maxLen": 512
      }
    },
    "returns": {},
    "errors": [
      "server_offline",
      "invalid_params"
    ]
  },
  {
    "type": "permission.register",
    "kind": "action",
    "runtime": "daemon",
    "since": "2.1.0",
    "stability": "stable",
    "scope": "write",
    "summary": "A mod registers the permission nodes it owns, namespaced by its name, each with a description and a default effect. Registration is idempotent — call it on every startup.",
    "params": {
      "mod": {
        "type": "string",
        "required": true,
        "maxLen": 32
      },
      "nodes": {
        "type": "json",
        "required": true
      }
    },
    "returns": {
      "registered": "int"
    },
    "errors": [
      "invalid_params"
    ]
  },
  {
    "type": "permission.check",
    "kind": "query",
    "runtime": "daemon",
    "target": "player",
    "since": "2.1.0",
    "stability": "stable",
    "scope": "read",
    "summary": "May this player do this? Resolves user overrides, then groups by weight, then the default group; deny beats allow. With `where`, the winning entry's constraints are also enforced — 'may spawn, but only Lamball' is one node plus a constraint.",
    "params": {
      "node": {
        "type": "string",
        "required": true,
        "maxLen": 128
      },
      "where": {
        "type": "json"
      }
    },
    "returns": {
      "allowed": "bool",
      "source": "string",
      "constraints": "json"
    },
    "errors": [
      "invalid_params"
    ]
  },
  {
    "type": "permission.grant",
    "kind": "action",
    "runtime": "daemon",
    "target": "player",
    "since": "2.1.0",
    "stability": "stable",
    "scope": "write",
    "summary": "Set a per-player override: allow or deny a node for this player, optionally constrained ({\"species\":{\"in\":[…]}}, {\"x\":{\"min\":0,\"max\":1000}}). Player overrides beat every group.",
    "params": {
      "node": {
        "type": "string",
        "required": true,
        "maxLen": 128
      },
      "effect": {
        "type": "string",
        "default": "allow",
        "maxLen": 8
      },
      "constraints": {
        "type": "json"
      }
    },
    "returns": {
      "node": "string",
      "effect": "string"
    },
    "errors": [
      "invalid_params"
    ]
  },
  {
    "type": "permission.revoke",
    "kind": "action",
    "runtime": "daemon",
    "target": "player",
    "since": "2.1.0",
    "stability": "stable",
    "scope": "write",
    "summary": "Remove a per-player override, so groups decide again.",
    "params": {
      "node": {
        "type": "string",
        "required": true,
        "maxLen": 128
      }
    },
    "returns": {
      "node": "string"
    },
    "errors": [
      "invalid_params"
    ]
  },
  {
    "type": "permission.nodes",
    "kind": "query",
    "runtime": "daemon",
    "since": "2.1.0",
    "stability": "stable",
    "scope": "read",
    "summary": "Every registered node, grouped by the mod that registered it, with defaults.",
    "params": {},
    "returns": {
      "nodes": "json"
    },
    "errors": []
  },
  {
    "type": "permission.player",
    "kind": "query",
    "runtime": "daemon",
    "target": "player",
    "since": "2.1.0",
    "stability": "stable",
    "scope": "read",
    "summary": "A player's permission state: their groups, their overrides, and their role tag.",
    "params": {},
    "returns": {
      "groups": "json",
      "entries": "json",
      "role": "string|null"
    },
    "errors": []
  },
  {
    "type": "group.create",
    "kind": "action",
    "runtime": "daemon",
    "since": "2.1.0",
    "stability": "stable",
    "scope": "write",
    "summary": "Create a permission group. tag is the [ROLE] shown in chat when enabled; weight orders groups when a player has several (highest wins).",
    "params": {
      "name": {
        "type": "item_id",
        "required": true
      },
      "tag": {
        "type": "string",
        "maxLen": 16
      },
      "weight": {
        "type": "int",
        "min": 0,
        "max": 1000,
        "default": 0
      }
    },
    "returns": {
      "name": "item_id"
    },
    "errors": [
      "invalid_params",
      "exists"
    ]
  },
  {
    "type": "group.update",
    "kind": "action",
    "runtime": "daemon",
    "since": "2.1.0",
    "stability": "stable",
    "scope": "write",
    "summary": "Change a group's tag or weight.",
    "params": {
      "name": {
        "type": "item_id",
        "required": true
      },
      "tag": {
        "type": "string",
        "maxLen": 16
      },
      "weight": {
        "type": "int",
        "min": 0,
        "max": 1000,
        "default": 0
      }
    },
    "returns": {
      "name": "item_id"
    },
    "errors": [
      "unknown_group"
    ]
  },
  {
    "type": "group.delete",
    "kind": "action",
    "runtime": "daemon",
    "since": "2.1.0",
    "stability": "stable",
    "scope": "write",
    "summary": "Delete a group (the default group cannot be deleted).",
    "params": {
      "name": {
        "type": "item_id",
        "required": true
      }
    },
    "returns": {
      "name": "item_id"
    },
    "errors": [
      "unknown_group"
    ]
  },
  {
    "type": "group.set_entry",
    "kind": "action",
    "runtime": "daemon",
    "since": "2.1.0",
    "stability": "stable",
    "scope": "write",
    "summary": "Set one node entry on a group: allow or deny, optionally constrained. Wildcards work ('chatshop.*', '*').",
    "params": {
      "group": {
        "type": "item_id",
        "required": true
      },
      "node": {
        "type": "string",
        "required": true,
        "maxLen": 128
      },
      "effect": {
        "type": "string",
        "default": "allow",
        "maxLen": 8
      },
      "constraints": {
        "type": "json"
      }
    },
    "returns": {
      "group": "item_id",
      "node": "string"
    },
    "errors": [
      "unknown_group",
      "invalid_params"
    ]
  },
  {
    "type": "group.remove_entry",
    "kind": "action",
    "runtime": "daemon",
    "since": "2.1.0",
    "stability": "stable",
    "scope": "write",
    "summary": "Remove a node entry from a group.",
    "params": {
      "group": {
        "type": "item_id",
        "required": true
      },
      "node": {
        "type": "string",
        "required": true,
        "maxLen": 128
      }
    },
    "returns": {
      "group": "item_id",
      "node": "string"
    },
    "errors": [
      "unknown_group"
    ]
  },
  {
    "type": "group.assign",
    "kind": "action",
    "runtime": "daemon",
    "target": "player",
    "since": "2.1.0",
    "stability": "stable",
    "scope": "write",
    "summary": "Put a player into a group.",
    "params": {
      "group": {
        "type": "item_id",
        "required": true
      }
    },
    "returns": {
      "group": "item_id"
    },
    "errors": [
      "unknown_group",
      "unknown_player"
    ]
  },
  {
    "type": "group.unassign",
    "kind": "action",
    "runtime": "daemon",
    "target": "player",
    "since": "2.1.0",
    "stability": "stable",
    "scope": "write",
    "summary": "Take a player out of a group.",
    "params": {
      "group": {
        "type": "item_id",
        "required": true
      }
    },
    "returns": {
      "group": "item_id"
    },
    "errors": [
      "unknown_group"
    ]
  },
  {
    "type": "group.list",
    "kind": "query",
    "runtime": "daemon",
    "since": "2.1.0",
    "stability": "stable",
    "scope": "read",
    "summary": "All groups with their entries, weights, tags and member counts.",
    "params": {},
    "returns": {
      "groups": "json"
    },
    "errors": []
  },
  {
    "type": "player.position",
    "kind": "query",
    "runtime": "agent",
    "target": "player",
    "since": "2.1.0",
    "stability": "stable",
    "scope": "read",
    "summary": "The online player's exact world position (Engine Actor location, includes z).",
    "params": {},
    "returns": {
      "x": "number",
      "y": "number",
      "z": "number"
    },
    "errors": [
      "player_offline"
    ]
  },
  {
    "type": "location.save",
    "kind": "action",
    "runtime": "daemon",
    "since": "2.1.0",
    "stability": "stable",
    "scope": "write",
    "summary": "Save a named world location for the teleport picker. Stand somewhere, read player.position, save it — fast-travel points, arenas, meeting spots.",
    "params": {
      "name": {
        "type": "string",
        "required": true,
        "maxLen": 64
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
    },
    "returns": {
      "name": "string"
    },
    "errors": [
      "invalid_params"
    ]
  },
  {
    "type": "location.list",
    "kind": "query",
    "runtime": "daemon",
    "since": "2.1.0",
    "stability": "stable",
    "scope": "read",
    "summary": "Saved locations plus boss-spawn positions observed live (source: manual | boss).",
    "params": {},
    "returns": {
      "locations": "json"
    },
    "errors": []
  },
  {
    "type": "location.delete",
    "kind": "action",
    "runtime": "daemon",
    "since": "2.1.0",
    "stability": "stable",
    "scope": "write",
    "summary": "Remove a saved location.",
    "params": {
      "name": {
        "type": "string",
        "required": true,
        "maxLen": 64
      }
    },
    "returns": {
      "name": "string"
    },
    "errors": [
      "unknown_location"
    ]
  },
  {
    "type": "pal.list",
    "kind": "query",
    "runtime": "agent",
    "since": "2.2.0",
    "stability": "experimental",
    "scope": "read",
    "summary": "Pals currently loaded in the world (players excluded), with species, level and — when the engine exposes it — a stable id usable as a pal.set_hp target. Capped at 100 rows; count reports the true total.",
    "params": {},
    "returns": {
      "count": "int",
      "truncated": "bool",
      "pals": "json"
    },
    "errors": []
  },
  {
    "type": "player.stats",
    "kind": "query",
    "runtime": "agent",
    "target": "player",
    "since": "2.5.0",
    "stability": "experimental",
    "scope": "read",
    "summary": "Read an online player's stats — hp/maxHp, hunger/maxHunger, shield/maxShield, sanity, plus level, rank, talent* IVs and rank* soul upgrades from the save parameter. A stat this build does not expose comes back null rather than absent.",
    "params": {},
    "returns": {
      "stats": "json"
    },
    "errors": [
      "player_offline"
    ]
  },
  {
    "type": "player.set_stats",
    "kind": "action",
    "runtime": "agent",
    "target": "player",
    "since": "2.5.0",
    "stability": "experimental",
    "scope": "write",
    "summary": "Set any combination of an online player's stats in one call; omitted fields are left alone. hp is a fraction of max (0-1); the rest are absolute. Combat and work stats (level, rank, talent* IVs, rank* soul upgrades) are written to the save parameter and replicated — pals carry all of them; a player character carries only what its own parameter exposes. Reports which fields applied and returns the resulting stats.",
    "params": {
      "hp": {
        "type": "number",
        "min": 0,
        "max": 1
      },
      "hunger": {
        "type": "number",
        "min": 0,
        "max": 1000
      },
      "shield": {
        "type": "number",
        "min": 0,
        "max": 100000
      },
      "maxShield": {
        "type": "number",
        "min": 1,
        "max": 100000
      },
      "level": {
        "type": "int",
        "min": 1,
        "max": 100
      },
      "rank": {
        "type": "int",
        "min": 1,
        "max": 5
      },
      "talentHp": {
        "type": "int",
        "min": 0,
        "max": 100
      },
      "talentMelee": {
        "type": "int",
        "min": 0,
        "max": 100
      },
      "talentShot": {
        "type": "int",
        "min": 0,
        "max": 100
      },
      "talentDefense": {
        "type": "int",
        "min": 0,
        "max": 100
      },
      "rankAttack": {
        "type": "int",
        "min": 0,
        "max": 10
      },
      "rankDefence": {
        "type": "int",
        "min": 0,
        "max": 10
      },
      "rankCraftSpeed": {
        "type": "int",
        "min": 0,
        "max": 10
      }
    },
    "returns": {
      "applied": "string",
      "failed": "string",
      "stats": "json"
    },
    "errors": [
      "player_offline",
      "not_supported"
    ]
  },
  {
    "type": "pal.stats",
    "kind": "query",
    "runtime": "agent",
    "since": "2.5.0",
    "stability": "experimental",
    "scope": "read",
    "summary": "Read a loaded pal's stats, targeting the id from pal.list or a pal.spawn result — including level, rank, talent* IVs and rank* soul upgrades.",
    "params": {
      "pal": {
        "type": "string",
        "required": true,
        "maxLen": 64,
        "picker": "worldpal"
      }
    },
    "returns": {
      "pal": "string",
      "species": "string",
      "stats": "json"
    },
    "errors": [
      "pal_not_found"
    ]
  },
  {
    "type": "pal.set_stats",
    "kind": "action",
    "runtime": "agent",
    "since": "2.5.0",
    "stability": "experimental",
    "scope": "write",
    "summary": "Set any combination of a loaded pal's stats in one call; omitted fields are left alone. Combat and work stats (level, rank, talent* IVs, rank* soul upgrades) are written to the save parameter and replicated.",
    "params": {
      "pal": {
        "type": "string",
        "required": true,
        "maxLen": 64,
        "picker": "worldpal"
      },
      "hp": {
        "type": "number",
        "min": 0,
        "max": 1
      },
      "hunger": {
        "type": "number",
        "min": 0,
        "max": 1000
      },
      "shield": {
        "type": "number",
        "min": 0,
        "max": 100000
      },
      "maxShield": {
        "type": "number",
        "min": 1,
        "max": 100000
      },
      "level": {
        "type": "int",
        "min": 1,
        "max": 100
      },
      "rank": {
        "type": "int",
        "min": 1,
        "max": 5
      },
      "talentHp": {
        "type": "int",
        "min": 0,
        "max": 100
      },
      "talentMelee": {
        "type": "int",
        "min": 0,
        "max": 100
      },
      "talentShot": {
        "type": "int",
        "min": 0,
        "max": 100
      },
      "talentDefense": {
        "type": "int",
        "min": 0,
        "max": 100
      },
      "rankAttack": {
        "type": "int",
        "min": 0,
        "max": 10
      },
      "rankDefence": {
        "type": "int",
        "min": 0,
        "max": 10
      },
      "rankCraftSpeed": {
        "type": "int",
        "min": 0,
        "max": 10
      }
    },
    "returns": {
      "pal": "string",
      "applied": "string",
      "stats": "json"
    },
    "errors": [
      "pal_not_found",
      "not_supported"
    ]
  },
  {
    "type": "pal.aggro",
    "kind": "action",
    "runtime": "agent",
    "target": "player",
    "since": "2.7.0",
    "stability": "experimental",
    "scope": "write",
    "summary": "Make a loaded pal hate a player, so it turns on them and fights. Seeds the engine's hate system directly — the mechanism damage normally uses, which spawned pals never receive. Signatures are probed; the result names the call that worked.",
    "params": {
      "pal": {
        "type": "string",
        "required": true,
        "maxLen": 64,
        "picker": "worldpal"
      },
      "amount": {
        "type": "int",
        "min": 1,
        "max": 100000,
        "default": 1000
      }
    },
    "returns": {
      "pal": "string",
      "amount": "int",
      "via": "string"
    },
    "errors": [
      "pal_not_found",
      "player_offline",
      "not_supported"
    ]
  },
  {
    "type": "pal.inspect",
    "kind": "query",
    "runtime": "agent",
    "since": "2.8.0",
    "stability": "experimental",
    "scope": "read",
    "summary": "Diagnostic dump for one loaded pal: its AI controller class, whether a player owns it, otomo flag, spawned type and whether it has a hate system. Run it on a wild pal and on a spawned one — the difference is why one fights back and the other does not.",
    "params": {
      "pal": {
        "type": "string",
        "required": true,
        "maxLen": 64,
        "picker": "worldpal"
      }
    },
    "returns": {
      "controller": "string",
      "hasController": "bool",
      "owner": "string",
      "isOtomo": "bool",
      "spawnedType": "int",
      "hateSystem": "bool"
    },
    "errors": [
      "pal_not_found"
    ]
  }
];

export const ACTIONS = new Map(
  CAPABILITIES.filter((c) => c.kind !== 'event').map((c) => [c.type, c]),
);
