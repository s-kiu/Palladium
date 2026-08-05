// Generated from packages/shared/bridge-capabilities.json — do not edit. Regenerate: node packages/shared/generate.mjs
export type ParamType = 'string' | 'int' | 'number' | 'bool' | 'item_id' | 'subject';

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
    "summary": "Spawn a pal near the target player (or at explicit coordinates), with level, rarity and passive-skill traits. The spawn pattern is community-proven but marked experimental by its authors.",
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
      }
    },
    "returns": {
      "species": "item_id",
      "level": "int"
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
  }
];

export const ACTIONS = new Map(
  CAPABILITIES.filter((c) => c.kind !== 'event').map((c) => [c.type, c]),
);
