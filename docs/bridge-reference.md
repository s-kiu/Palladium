# Bridge capability reference

<!-- Generated from packages/shared/bridge-capabilities.json — do not edit. Regenerate: node packages/shared/generate.mjs -->

Envelope version 2. Every message is
`{v, id?, at, kind, type, subject?, data}`; results add `ok` and `error`.
Stability: **stable** shapes only ever gain fields; **experimental** may change
or vanish. `GET /api/bridge/schema` reports this table merged with what is
actually live on the running server.

## bridge.*

| Type | Kind | Runtime | Stability | Since | Fields | Summary |
|---|---|---|---|---|---|---|
| `bridge.ready` | event | agent | stable | 2.0.0 | `agent` · string<br>`version` · string<br>`envelope` · int | The in-game agent loaded. Carries its version and the actions it can execute; its absence is what 'no bridge' means. |
| `bridge.hook` | event | agent | stable | 2.0.0 | `hook` · string<br>`target` · string<br>`ok` · bool | One per engine hook the agent tried to register, reporting whether it is live. A failed hook costs its event type and nothing else. |

## player.*

| Type | Kind | Runtime | Stability | Since | Fields | Summary |
|---|---|---|---|---|---|---|
| `player.chat` | event | agent | stable | 1.0.0 | `message` · string | A player sent a chat message. The text is untrusted input, capped at 512 characters. |
| `player.join` | event | agent | stable | 1.1.0 | `firstThisRun` · bool<br>`firstEver` · bool · HTTP door only<br>`firstSeen` · int · HTTP door only<br>`joins` · int · HTTP door only | A player's character finished initialising after connecting. firstEver/joins/firstSeen are enriched by the daemon from its database and are present on the HTTP door only. |
| `player.respawn` | event | agent | experimental | 2.0.0 | _none_ | A player's character re-initialised right after a death — a respawn, not a join. Heuristic: only emitted when the same player died since their last event. |
| `player.death` | event | agent | stable | 1.1.0 | `killer` · subject · optional | A player died. Pals dying are not reported. killer is a full subject when another player did it; attribution is best-effort. |
| `player.leave` | event | daemon | stable | 1.1.0 | `source` · string | A player disconnected. Derived from the game's REST player list (no hookable disconnect exists on this loader), so it arrives within a few seconds rather than instantly. |
| `player.message` | action | agent | stable | 1.1.0 | `text` · string · required | Send a private system-chat message to one online player. |
| `player.give_item` | action | agent | stable | 1.1.0 | `item` · item_id · required<br>`count` · int · default 1 · 1…9999 | Put items into an online player's inventory. Item ids are the game's internal names (bread is Pan); an unknown id is accepted by the game and silently does nothing. |
| `player.teleport` | action | agent | experimental | 2.0.0 | `x` · number · required<br>`y` · number · required<br>`z` · number · required | Teleport an online player to world coordinates (Engine Actor K2_TeleportTo). |
| `player.heal` | action | agent | experimental | 2.0.0 | _none_ | Fully restore an online player's HP (PalUtility FullRecoveryHP). |
| `player.count_item` | query | agent | experimental | 2.0.0 | `item` · item_id · required | How many of an item an online player carries. Money is the item id for gold. |
| `player.has_item` | query | agent | experimental | 2.0.0 | `item` · item_id · required<br>`count` · int · default 1 · 1…999999 | Whether an online player carries at least `count` of an item. |
| `player.set_tag` | action | daemon | stable | 2.0.0 | `key` · string · required<br>`value` · string · required | Attach a key/value to a player, kept in the daemon's database across restarts. The persistence primitive for 'already got the kit', ranks, notes. |
| `player.get_tag` | query | daemon | stable | 2.0.0 | `key` · string · required | Read one of a player's tags. ok with value null when the tag is unset. |
| `player.delete_tag` | action | daemon | stable | 2.0.0 | `key` · string · required | Remove a tag from a player. |
| `player.position` | query | agent | stable | 2.1.0 | _none_ | The online player's exact world position (Engine Actor location, includes z). |
| `player.set_hp` | action | agent | experimental | 2.2.0 | `rate` · number · required · 0…1 | Set an online player's HP as a fraction of max (0 downs them, 1 is full). |
| `player.set_hunger` | action | agent | experimental | 2.2.0 | `value` · number · required · 0…1000 | Set an online player's fullness (hunger bar). 100 is a full stomach. |
| `player.set_shield` | action | agent | experimental | 2.2.0 | `hp` · number · required · 0…100000<br>`max` · number · 1…100000 | Set an online player's shield HP, optionally its maximum too. |

## npc.*

| Type | Kind | Runtime | Stability | Since | Fields | Summary |
|---|---|---|---|---|---|---|
| `npc.spawn` | event | agent | experimental | 2.0.0 | `species` · string<br>`level` · int<br>`rare` · bool | A pal/NPC finished parameter initialisation — fires on world spawns near players. Player characters are filtered out. Throttled to 20 events per second. |

## pal.*

| Type | Kind | Runtime | Stability | Since | Fields | Summary |
|---|---|---|---|---|---|---|
| `pal.spawn` | action | agent | experimental | 2.0.0 | `species` · item_id · required<br>`level` · int · default 10 · 1…100<br>`rare` · bool · default false<br>`traits` · string<br>`x` · number<br>`y` · number<br>`z` · number | Spawn a pal near the target player (or at explicit coordinates), with level, rarity and passive-skill traits. Spawned pals use the base NPC AI (they do not initiate attacks) and are not part of the world save — a server restart removes them. The npc.spawn event that follows carries the new pal's id. |
| `pal.list` | query | agent | experimental | 2.2.0 | _none_ | Pals currently loaded in the world (players excluded), with species, level and — when the engine exposes it — a stable id usable as a pal.set_hp target. Capped at 100 rows; count reports the true total. |
| `pal.set_hp` | action | agent | experimental | 2.2.0 | `pal` · string · required<br>`rate` · number · required · 0…1 | Set a loaded pal's HP by rate, targeting the id from pal.list or an npc.spawn event. |

## server.*

| Type | Kind | Runtime | Stability | Since | Fields | Summary |
|---|---|---|---|---|---|---|
| `server.announce` | action | game-rest | stable | 1.0.0 | `message` · string · required | Broadcast a message to everyone online, via the game's own REST API. |

## permission.*

| Type | Kind | Runtime | Stability | Since | Fields | Summary |
|---|---|---|---|---|---|---|
| `permission.register` | action | daemon | stable | 2.1.0 | `mod` · string · required<br>`nodes` · json · required | A mod registers the permission nodes it owns, namespaced by its name, each with a description and a default effect. Registration is idempotent — call it on every startup. |
| `permission.check` | query | daemon | stable | 2.1.0 | `node` · string · required<br>`where` · json | May this player do this? Resolves user overrides, then groups by weight, then the default group; deny beats allow. With `where`, the winning entry's constraints are also enforced — 'may spawn, but only Lamball' is one node plus a constraint. |
| `permission.grant` | action | daemon | stable | 2.1.0 | `node` · string · required<br>`effect` · string · default "allow"<br>`constraints` · json | Set a per-player override: allow or deny a node for this player, optionally constrained ({"species":{"in":[…]}}, {"x":{"min":0,"max":1000}}). Player overrides beat every group. |
| `permission.revoke` | action | daemon | stable | 2.1.0 | `node` · string · required | Remove a per-player override, so groups decide again. |
| `permission.nodes` | query | daemon | stable | 2.1.0 | _none_ | Every registered node, grouped by the mod that registered it, with defaults. |
| `permission.player` | query | daemon | stable | 2.1.0 | _none_ | A player's permission state: their groups, their overrides, and their role tag. |

## group.*

| Type | Kind | Runtime | Stability | Since | Fields | Summary |
|---|---|---|---|---|---|---|
| `group.create` | action | daemon | stable | 2.1.0 | `name` · item_id · required<br>`tag` · string<br>`weight` · int · default 0 · 0…1000 | Create a permission group. tag is the [ROLE] shown in chat when enabled; weight orders groups when a player has several (highest wins). |
| `group.update` | action | daemon | stable | 2.1.0 | `name` · item_id · required<br>`tag` · string<br>`weight` · int · default 0 · 0…1000 | Change a group's tag or weight. |
| `group.delete` | action | daemon | stable | 2.1.0 | `name` · item_id · required | Delete a group (the default group cannot be deleted). |
| `group.set_entry` | action | daemon | stable | 2.1.0 | `group` · item_id · required<br>`node` · string · required<br>`effect` · string · default "allow"<br>`constraints` · json | Set one node entry on a group: allow or deny, optionally constrained. Wildcards work ('chatshop.*', '*'). |
| `group.remove_entry` | action | daemon | stable | 2.1.0 | `group` · item_id · required<br>`node` · string · required | Remove a node entry from a group. |
| `group.assign` | action | daemon | stable | 2.1.0 | `group` · item_id · required | Put a player into a group. |
| `group.unassign` | action | daemon | stable | 2.1.0 | `group` · item_id · required | Take a player out of a group. |
| `group.list` | query | daemon | stable | 2.1.0 | _none_ | All groups with their entries, weights, tags and member counts. |

## location.*

| Type | Kind | Runtime | Stability | Since | Fields | Summary |
|---|---|---|---|---|---|---|
| `location.save` | action | daemon | stable | 2.1.0 | `name` · string · required<br>`x` · number · required<br>`y` · number · required<br>`z` · number · required | Save a named world location for the teleport picker. Stand somewhere, read player.position, save it — fast-travel points, arenas, meeting spots. |
| `location.list` | query | daemon | stable | 2.1.0 | _none_ | Saved locations plus boss-spawn positions observed live (source: manual | boss). |
| `location.delete` | action | daemon | stable | 2.1.0 | `name` · string · required | Remove a saved location. |
