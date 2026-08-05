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

## npc.*

| Type | Kind | Runtime | Stability | Since | Fields | Summary |
|---|---|---|---|---|---|---|
| `npc.spawn` | event | agent | experimental | 2.0.0 | `species` · string<br>`level` · int<br>`rare` · bool | A pal/NPC finished parameter initialisation — fires on world spawns near players. Player characters are filtered out. Throttled to 20 events per second. |

## pal.*

| Type | Kind | Runtime | Stability | Since | Fields | Summary |
|---|---|---|---|---|---|---|
| `pal.spawn` | action | agent | experimental | 2.0.0 | `species` · item_id · required<br>`level` · int · default 10 · 1…100<br>`rare` · bool · default false<br>`traits` · string<br>`x` · number<br>`y` · number<br>`z` · number | Spawn a pal near the target player (or at explicit coordinates), with level, rarity and passive-skill traits. The spawn pattern is community-proven but marked experimental by its authors. |

## server.*

| Type | Kind | Runtime | Stability | Since | Fields | Summary |
|---|---|---|---|---|---|---|
| `server.announce` | action | game-rest | stable | 1.0.0 | `message` · string · required | Broadcast a message to everyone online, via the game's own REST API. |
