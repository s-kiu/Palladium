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
  group?: 'player' | 'pals' | 'world' | 'permissions' | 'agent';
  subject?: string;
  target?: string;
  targetOptional?: boolean;
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
    "summary": "A player's character finished initialising after connecting. firstEver, firstSeen and joins come from the agent's own registry, which outlives the event file.",
    "scope": "read",
    "data": {
      "firstThisRun": {
        "type": "bool"
      },
      "firstEver": {
        "type": "bool"
      },
      "firstSeen": {
        "type": "int"
      },
      "joins": {
        "type": "int"
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
    "runtime": "agent",
    "subject": "player",
    "since": "1.1.0",
    "stability": "stable",
    "scope": "read",
    "summary": "A player disconnected. No hookable disconnect exists on this loader, so the agent notices by watching who is still in the world and reports it within a few seconds rather than instantly.",
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
    "type": "player.hour",
    "kind": "event",
    "runtime": "agent",
    "subject": "player",
    "since": "4.5.0",
    "stability": "experimental",
    "scope": "read",
    "summary": "A player's counted playtime just completed another full hour. Fired by the same minute-ticker that credits playtime, so it lands within a minute of the boundary and only while they are online. Carries the new hour total and the exact minute count.",
    "data": {
      "hours": {
        "type": "int"
      },
      "minutes": {
        "type": "int"
      }
    }
  },
  {
    "type": "clock.minute",
    "kind": "event",
    "runtime": "agent",
    "subject": "server",
    "since": "4.5.0",
    "stability": "experimental",
    "scope": "read",
    "summary": "The wall-clock minute turned, in server-local time. The event mods schedule real-world things against — a weekday, hour and minute comparison replaces owning a timer. Published within two seconds of the minute boundary.",
    "data": {
      "date": {
        "type": "string"
      },
      "weekday": {
        "type": "string"
      },
      "hour": {
        "type": "int"
      },
      "minute": {
        "type": "int"
      }
    }
  },
  {
    "type": "clock.day",
    "kind": "event",
    "runtime": "agent",
    "subject": "server",
    "since": "4.6.0",
    "stability": "experimental",
    "scope": "read",
    "summary": "The date turned, in server-local time — published at the first minute of the new day. A boot mid-day is not a turn. The event daily things schedule against without stamp arithmetic.",
    "data": {
      "date": {
        "type": "string"
      },
      "weekday": {
        "type": "string"
      }
    }
  },
  {
    "type": "player.item_use",
    "kind": "event",
    "runtime": "agent",
    "subject": "player",
    "source": {
      "hook": "/Script/Pal.PalPlayerController:RequestUseItemToCharacter_ToServer"
    },
    "since": "4.11.0",
    "stability": "experimental",
    "scope": "read",
    "summary": "A player used an item through the use-on-character path — feeding and healing pals, and eating from their own inventory, all fire it (verified live). The slot and count are known; resolving which item sat in the slot, and the target, is future work.",
    "data": {
      "count": {
        "type": "int"
      },
      "slot": {
        "type": "string"
      },
      "target": {
        "type": "string"
      }
    }
  },
  {
    "type": "player.message",
    "kind": "action",
    "runtime": "agent",
    "group": "player",
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
    "group": "player",
    "target": "player",
    "since": "1.1.0",
    "stability": "stable",
    "scope": "write",
    "summary": "Hand items to a player. The count is read before and after, so the result says whether they arrived: an unknown item id is reported as a failure rather than a success that added nothing.",
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
      "count": "int",
      "delivered": "bool",
      "gained": "int"
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
    "group": "player",
    "target": "player",
    "since": "2.0.0",
    "stability": "experimental",
    "scope": "write",
    "summary": "Move an online player. The destination is x/y/z coordinates, or another player: `to` names one and their position is the target — in chat, `!teleport to=@Name` is 'take me to them' and `!teleport @Name to=@me` is 'bring them here'. The result reports where they actually landed; a move that went nowhere is a failure, not a success.",
    "params": {
      "x": {
        "type": "number"
      },
      "y": {
        "type": "number"
      },
      "z": {
        "type": "number"
      },
      "to": {
        "type": "string",
        "maxLen": 64
      }
    },
    "returns": {
      "x": "number",
      "y": "number",
      "z": "number",
      "via": "string"
    },
    "errors": [
      "player_offline",
      "invalid_params",
      "teleport_failed"
    ]
  },
  {
    "type": "player.heal",
    "kind": "action",
    "runtime": "agent",
    "group": "player",
    "target": "player",
    "since": "2.0.0",
    "stability": "experimental",
    "scope": "write",
    "summary": "Restore an online player to full: HP back to maximum and a full stomach, shield included where the build exposes it. Reports which of the three actually moved, and why any of them did not.",
    "params": {},
    "returns": {
      "applied": "string",
      "failed": "string",
      "detail": "string",
      "stats": "json"
    },
    "errors": [
      "player_offline",
      "not_supported"
    ]
  },
  {
    "type": "player.count_item",
    "kind": "query",
    "runtime": "agent",
    "group": "player",
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
    "group": "player",
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
    "group": "pals",
    "target": "player",
    "targetOptional": true,
    "since": "2.0.0",
    "stability": "experimental",
    "scope": "write",
    "summary": "Spawn a pal, at explicit coordinates or beside a target player. One of the two is required; with coordinates the pal is placed there and the result reports where it landed. Level, rarity and passive-skill traits apply on spawn. hostile=true additionally turns the new pal on the target player through pal.aggro and reports whether that took. Spawns are not part of the world save: a server restart removes them. The result carries the new pal's id.",
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
      "x": "number",
      "y": "number",
      "z": "number",
      "hostile": "bool",
      "controller": "string",
      "aggro": "string"
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
    "runtime": "agent",
    "group": "player",
    "target": "player",
    "since": "2.0.0",
    "stability": "stable",
    "scope": "write",
    "summary": "Attach a key/value to a player, kept by the agent across restarts. The persistence primitive for 'already got the kit', ranks, notes.",
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
    ],
    "targetOptional": true
  },
  {
    "type": "player.get_tag",
    "kind": "query",
    "runtime": "agent",
    "group": "player",
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
    ],
    "targetOptional": true
  },
  {
    "type": "player.delete_tag",
    "kind": "action",
    "runtime": "agent",
    "group": "player",
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
    ],
    "targetOptional": true
  },
  {
    "type": "server.announce",
    "kind": "action",
    "runtime": "agent",
    "group": "world",
    "target": "server",
    "since": "1.0.0",
    "stability": "stable",
    "scope": "write",
    "summary": "Tell everyone online something, as system chat. The agent sends it to each player itself, so a mod in the game can announce without anything outside it.",
    "params": {
      "message": {
        "type": "string",
        "required": true,
        "maxLen": 512
      }
    },
    "returns": {
      "players": "int"
    },
    "errors": [
      "server_offline",
      "invalid_params"
    ]
  },
  {
    "type": "permission.register",
    "kind": "action",
    "runtime": "agent",
    "group": "permissions",
    "since": "2.1.0",
    "stability": "stable",
    "scope": "write",
    "summary": "A mod registers one permission node it owns, namespaced by its name, with a description and a default effect. Idempotent, and an operator's change to the default in permissions.config outranks it.",
    "params": {
      "mod": {
        "type": "string",
        "required": true,
        "maxLen": 32
      },
      "node": {
        "type": "string",
        "required": true,
        "maxLen": 128
      },
      "description": {
        "type": "string",
        "maxLen": 200
      },
      "default": {
        "type": "string",
        "maxLen": 8
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
    "type": "permission.check",
    "kind": "query",
    "runtime": "agent",
    "group": "permissions",
    "target": "player",
    "since": "2.1.0",
    "stability": "stable",
    "scope": "read",
    "summary": "May this player do this? Resolves user overrides, then groups by weight, then the default group, then the node's default; deny beats allow. Any parameter beyond `node` is taken as the call being asked about and matched against the winning entry's constraint — 'may spawn, but only Lamball' is one node plus a constraint.",
    "params": {
      "node": {
        "type": "string",
        "required": true,
        "maxLen": 128
      },
      "target": {
        "type": "string",
        "maxLen": 64
      }
    },
    "returns": {
      "allowed": "bool",
      "source": "string",
      "constraints": "string",
      "violation": "string"
    },
    "errors": [
      "invalid_params"
    ],
    "targetOptional": true
  },
  {
    "type": "permission.grant",
    "kind": "action",
    "runtime": "agent",
    "group": "permissions",
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
      },
      "until": {
        "type": "string",
        "maxLen": 20
      },
      "where": {
        "type": "string",
        "maxLen": 200
      }
    },
    "returns": {
      "node": "string",
      "effect": "string"
    },
    "errors": [
      "invalid_params"
    ],
    "targetOptional": true
  },
  {
    "type": "permission.revoke",
    "kind": "action",
    "runtime": "agent",
    "group": "permissions",
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
    ],
    "targetOptional": true
  },
  {
    "type": "permission.nodes",
    "kind": "query",
    "runtime": "agent",
    "group": "permissions",
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
    "runtime": "agent",
    "group": "permissions",
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
    "errors": [],
    "targetOptional": true
  },
  {
    "type": "group.create",
    "kind": "action",
    "runtime": "agent",
    "group": "permissions",
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
    "runtime": "agent",
    "group": "permissions",
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
    "runtime": "agent",
    "group": "permissions",
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
    "runtime": "agent",
    "group": "permissions",
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
      },
      "until": {
        "type": "string",
        "maxLen": 20
      },
      "where": {
        "type": "string",
        "maxLen": 200
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
    "runtime": "agent",
    "group": "permissions",
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
    "runtime": "agent",
    "group": "permissions",
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
    ],
    "targetOptional": true
  },
  {
    "type": "group.unassign",
    "kind": "action",
    "runtime": "agent",
    "group": "permissions",
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
    ],
    "targetOptional": true
  },
  {
    "type": "group.list",
    "kind": "query",
    "runtime": "agent",
    "group": "permissions",
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
    "group": "player",
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
    "runtime": "agent",
    "group": "world",
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
    "runtime": "agent",
    "group": "world",
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
    "runtime": "agent",
    "group": "world",
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
    "group": "pals",
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
    "group": "player",
    "target": "player",
    "since": "2.5.0",
    "stability": "experimental",
    "scope": "read",
    "summary": "Read an online player's stats — hp/maxHp, hunger/maxHunger, shield/maxShield, sanity, plus level, rank, talent* IVs and rank* soul upgrades from the save parameter. A stat this build does not expose comes back null rather than absent.",
    "params": {},
    "returns": {
      "level": "int",
      "hp": "number",
      "maxHp": "number",
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
    "group": "player",
    "target": "player",
    "since": "2.5.0",
    "stability": "experimental",
    "scope": "write",
    "summary": "Set any combination of an online player's stats in one call; omitted fields are left alone. Values are absolute, on the same scale player.stats reports — hp is converted to the rate the engine wants using the maximum it reports; asking for more HP than the maximum raises the maximum with it. Combat and work stats (level, rank, talent* IVs, rank* soul upgrades) are written to the save parameter and replicated — they are pal stats, and a player character is refused them rather than told they applied (player.status_point is the equivalent). Every write is read back: applied lists what changed, unverified what the engine accepted without visibly changing, failed what it refused.",
    "params": {
      "hp": {
        "type": "number",
        "min": 0,
        "max": 100000000
      },
      "maxHp": {
        "type": "number",
        "min": 1,
        "max": 100000000
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
      "unverified": "string",
      "failed": "string",
      "detail": "string",
      "stats": "json"
    },
    "errors": [
      "player_offline",
      "not_supported"
    ]
  },
  {
    "type": "player.set_immortal",
    "kind": "action",
    "runtime": "agent",
    "target": "player",
    "since": "4.18.0",
    "stability": "experimental",
    "scope": "write",
    "summary": "Make a player unkillable, or mortal again. Raises DefenseUp so almost nothing gets through, and refills health and stomach on the agent's tick as a backstop; their own defence is remembered and handed back. Stamina is deliberately untouched — the client draws that bar from its own simulation, so a server-side refill only fights it.",
    "params": {
      "on": {
        "type": "bool",
        "default": true
      }
    },
    "returns": {
      "immortal": "bool",
      "was": "bool",
      "can_be_damaged": "bool",
      "defence": "string"
    }
  },
  {
    "type": "player.set_frozen",
    "kind": "action",
    "runtime": "agent",
    "target": "player",
    "since": "4.20.0",
    "stability": "experimental",
    "scope": "write",
    "summary": "Hold a player still, or let them go. Movement is simulated on the player's own machine, so a server-side speed of zero does not stop them; the agent anchors them instead and puts them back when they move more than a step. Enforcement rather than prevention: a frozen player can take that step before being returned.",
    "params": {
      "on": {
        "type": "bool",
        "default": true
      }
    },
    "returns": {
      "frozen": "bool",
      "anchored": "bool"
    }
  },
  {
    "type": "player.set_flying",
    "kind": "action",
    "runtime": "agent",
    "target": "player",
    "since": "4.20.0",
    "stability": "experimental",
    "scope": "write",
    "summary": "Ask a player's game to start or end flight. The server cannot fly a player on its own — flight is a mode the client enters — so this sends an instruction the optional AdminControlsClient mod acts on. Unverified by design: nothing reports flight back, and without the client mod installed nothing happens.",
    "params": {
      "on": {
        "type": "bool",
        "default": true
      }
    },
    "returns": {
      "flying": "bool",
      "verified": "bool",
      "via": "string"
    }
  },
  {
    "type": "player.status_points",
    "kind": "query",
    "runtime": "agent",
    "group": "player",
    "target": "player",
    "since": "3.1.0",
    "stability": "experimental",
    "scope": "read",
    "summary": "An online player's status points — the allocation the game computes their max HP, stamina, attack and carry weight from. Names are the game's own; the ones this build answers for are what comes back.",
    "params": {},
    "returns": {
      "via": "string",
      "holder": "string",
      "points": "json"
    },
    "errors": [
      "player_offline",
      "not_supported"
    ]
  },
  {
    "type": "player.status_point",
    "kind": "action",
    "runtime": "agent",
    "group": "player",
    "target": "player",
    "since": "3.1.0",
    "stability": "experimental",
    "scope": "write",
    "summary": "Spend status points on one of a player's stats, the way a level-up does. This is how a player's max HP goes up: it is computed from the points, not stored, so nothing else can raise it. Additive. stat is the game's own FName for the stat and is passed through verbatim — this build spends through the player controller and exposes no way to read the allocation back, so the result reports which readable stat moved instead. player.status_points lists the names to try.",
    "params": {
      "stat": {
        "type": "string",
        "required": true,
        "maxLen": 32
      },
      "points": {
        "type": "int",
        "min": 1,
        "max": 1000,
        "default": 1
      }
    },
    "returns": {
      "stat": "string",
      "points": "int",
      "via": "string",
      "verified": "bool",
      "stats": "json"
    },
    "errors": [
      "player_offline",
      "invalid_params",
      "not_supported"
    ]
  },
  {
    "type": "player.playtime",
    "kind": "query",
    "runtime": "agent",
    "group": "player",
    "target": "player",
    "since": "4.4.0",
    "stability": "experimental",
    "scope": "read",
    "summary": "Minutes a player has actually spent on this server, credited one minute at a time while they are online — a crash costs at most the minute in progress. Also reports the current session's minutes and whether they are online right now. Answers for offline players too: the total is history, not presence.",
    "params": {},
    "returns": {
      "minutes": "int",
      "session": "int",
      "online": "bool",
      "name": "string"
    },
    "errors": [
      "invalid_params"
    ],
    "targetOptional": true
  },
  {
    "type": "pal.stats",
    "kind": "query",
    "runtime": "agent",
    "group": "pals",
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
    "group": "pals",
    "since": "2.5.0",
    "stability": "experimental",
    "scope": "write",
    "summary": "Set any combination of a loaded pal's stats in one call; omitted fields are left alone. Values are absolute, on the same scale pal.stats reports — hp is converted to the rate the engine wants using the maximum it reports; asking for more HP than the maximum raises the maximum with it. Combat and work stats (level, rank, talent* IVs, rank* soul upgrades) are written to the save parameter and replicated — they are pal stats, and a player character is refused them rather than told they applied (player.status_point is the equivalent). Every write is read back: applied lists what changed, unverified what the engine accepted without visibly changing, failed what it refused.",
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
        "max": 100000000
      },
      "maxHp": {
        "type": "number",
        "min": 1,
        "max": 100000000
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
      "unverified": "string",
      "failed": "string",
      "detail": "string",
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
    "group": "pals",
    "target": "player",
    "since": "2.7.0",
    "stability": "experimental",
    "scope": "write",
    "summary": "Make a loaded pal hate a player, so it turns on them and fights. The hate system itself is not callable on this build, so the pal, its controller and its parameter component are searched for a hate function that is, and the engine's own damage path is the last resort. The result names the call that worked; a failure lists the hate-related functions this build does expose. sight=true additionally flips the pal's sensor temperament to attack-on-sight — it then goes for anyone who comes close, not only the caller.",
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
      },
      "sight": {
        "type": "bool",
        "default": false
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
    "group": "pals",
    "since": "2.8.0",
    "stability": "experimental",
    "scope": "read",
    "summary": "Diagnostic dump for one loaded pal: its AI controller class, whether a player owns it, otomo flag, spawned type, and whether a hate system exists on it (which is not the same as it hating anyone). Run it on a wild pal and on a spawned one — the difference is why one fights back and the other does not.",
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
  },
  {
    "type": "pal.spawn_wild",
    "kind": "action",
    "runtime": "agent",
    "group": "pals",
    "target": "player",
    "since": "4.8.0",
    "stability": "experimental",
    "scope": "write",
    "summary": "Spawn a real wild pal: one of the world's own spawners near the player fires, so the game itself wires the newcomer — controller, wild group, combat permission. With a species, the spawner's lottery is rewritten for the shot and restored right after; aggressive=true also sets the newcomer's temperament to attack-on-sight. Without a species the spawner rolls its own table; kind=boss prefers an alpha spawner. Contrast pal.spawn, which places a hand-made pal at exact coordinates but outside the world's own wiring.",
    "params": {
      "species": {
        "type": "item_id",
        "picker": "pal"
      },
      "level": {
        "type": "int",
        "min": 1,
        "max": 100,
        "default": 15
      },
      "aggressive": {
        "type": "bool",
        "default": false
      },
      "kind": {
        "type": "string",
        "default": "nearest",
        "maxLen": 16
      },
      "radius": {
        "type": "number",
        "min": 0,
        "max": 1000000,
        "default": 50000
      }
    },
    "returns": {
      "method": "string",
      "boss": "bool",
      "distance": "number",
      "spawnersInRange": "int"
    },
    "errors": [
      "player_offline",
      "not_supported"
    ]
  },
  {
    "type": "pal.force_spawn",
    "kind": "action",
    "runtime": "agent",
    "group": "pals",
    "target": "player",
    "since": "2.9.0",
    "stability": "experimental",
    "scope": "write",
    "summary": "Deprecated alias of pal.spawn_wild — same behavior, kept so existing scripts keep working.",
    "params": {
      "species": {
        "type": "item_id",
        "picker": "pal"
      },
      "level": {
        "type": "int",
        "min": 1,
        "max": 100,
        "default": 15
      },
      "aggressive": {
        "type": "bool",
        "default": false
      },
      "kind": {
        "type": "string",
        "default": "nearest",
        "maxLen": 16
      },
      "radius": {
        "type": "number",
        "min": 0,
        "max": 1000000,
        "default": 50000
      }
    },
    "returns": {
      "method": "string",
      "boss": "bool",
      "distance": "number",
      "spawnersInRange": "int"
    },
    "errors": [
      "player_offline",
      "not_supported"
    ]
  },
  {
    "type": "bridge.probe",
    "kind": "query",
    "runtime": "agent",
    "group": "agent",
    "target": "player",
    "targetOptional": true,
    "since": "3.0.0",
    "stability": "experimental",
    "scope": "read",
    "summary": "Which engine functions and properties this build actually exposes on an object, narrowed by substring. Reads the class chain through reflection and calls nothing, so it is safe to point anywhere. This is the answer to a not_supported: it names what does exist, fields included — a value the engine keeps in a property rather than behind a getter is invisible to a function list alone. on: player | state | controller | params | pal | palai | palparams | utility | manager | spawner, or class:<UClassName> for any live object by its class.",
    "params": {
      "on": {
        "type": "string",
        "default": "player",
        "maxLen": 64
      },
      "pal": {
        "type": "string",
        "maxLen": 64,
        "picker": "worldpal"
      },
      "filter": {
        "type": "string",
        "maxLen": 32
      }
    },
    "returns": {
      "on": "string",
      "class": "string",
      "count": "int",
      "functions": "json",
      "properties": "json"
    },
    "errors": [
      "player_offline",
      "pal_not_found",
      "not_supported"
    ]
  },
  {
    "type": "data.collections",
    "kind": "query",
    "runtime": "agent",
    "group": "world",
    "since": "3.2.0",
    "stability": "experimental",
    "scope": "read",
    "summary": "Every collection the agent and its mods have declared, with its owner, storage class and field shape — enough to render one this caller has never heard of.",
    "params": {},
    "returns": {
      "collections": "json"
    },
    "errors": []
  },
  {
    "type": "data.list",
    "kind": "query",
    "runtime": "agent",
    "group": "world",
    "since": "3.2.0",
    "stability": "experimental",
    "scope": "read",
    "summary": "Every record in one collection, by its qualified name (owner.name).",
    "params": {
      "collection": {
        "type": "string",
        "required": true,
        "maxLen": 96
      }
    },
    "returns": {
      "collection": "string",
      "records": "json",
      "count": "int"
    },
    "errors": [
      "unknown_collection",
      "invalid_params"
    ]
  },
  {
    "type": "data.get",
    "kind": "query",
    "runtime": "agent",
    "group": "world",
    "since": "3.2.0",
    "stability": "experimental",
    "scope": "read",
    "summary": "One record from a collection. ok with record null when it is not there.",
    "params": {
      "collection": {
        "type": "string",
        "required": true,
        "maxLen": 96
      },
      "record": {
        "type": "string",
        "required": true,
        "maxLen": 128
      }
    },
    "returns": {
      "record": "json"
    },
    "errors": [
      "unknown_collection",
      "invalid_params"
    ]
  },
  {
    "type": "data.set",
    "kind": "action",
    "runtime": "agent",
    "group": "world",
    "since": "3.2.0",
    "stability": "experimental",
    "scope": "write",
    "summary": "Write one record. Every parameter beyond collection and record becomes a field on it, so the call carries the shape the collection declared. List-valued fields cannot be set this way yet.",
    "params": {
      "collection": {
        "type": "string",
        "required": true,
        "maxLen": 96
      },
      "record": {
        "type": "string",
        "required": true,
        "maxLen": 128
      }
    },
    "returns": {
      "collection": "string",
      "record": "string"
    },
    "errors": [
      "unknown_collection",
      "invalid_params"
    ]
  },
  {
    "type": "data.delete",
    "kind": "action",
    "runtime": "agent",
    "group": "world",
    "since": "3.2.0",
    "stability": "experimental",
    "scope": "write",
    "summary": "Remove one record from a collection.",
    "params": {
      "collection": {
        "type": "string",
        "required": true,
        "maxLen": 96
      },
      "record": {
        "type": "string",
        "required": true,
        "maxLen": 128
      }
    },
    "returns": {
      "removed": "bool"
    },
    "errors": [
      "unknown_collection",
      "invalid_params"
    ]
  }
];

export const ACTIONS = new Map(
  CAPABILITIES.filter((c) => c.kind !== 'event').map((c) => [c.type, c]),
);
