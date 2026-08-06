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
| `bridge.probe` | query | agent | experimental | 3.0.0 | `on` · string · default "player"<br>`pal` · string<br>`filter` · string | Which engine functions and properties this build actually exposes on an object, narrowed by substring. Reads the class chain through reflection and calls nothing, so it is safe to point anywhere. This is the answer to a not_supported: it names what does exist, fields included — a value the engine keeps in a property rather than behind a getter is invisible to a function list alone. on: player | state | controller | params | pal | palai | palparams | utility | manager | spawner, or class:<UClassName> for any live object by its class. |

## player.*

| Type | Kind | Runtime | Stability | Since | Fields | Summary |
|---|---|---|---|---|---|---|
| `player.chat` | event | agent | stable | 1.0.0 | `message` · string | A player sent a chat message. The text is untrusted input, capped at 512 characters. |
| `player.join` | event | agent | stable | 1.1.0 | `firstThisRun` · bool<br>`firstEver` · bool<br>`firstSeen` · int<br>`joins` · int | A player's character finished initialising after connecting. firstEver, firstSeen and joins come from the agent's own registry, which outlives the event file. |
| `player.respawn` | event | agent | experimental | 2.0.0 | _none_ | A player's character re-initialised right after a death — a respawn, not a join. Heuristic: only emitted when the same player died since their last event. |
| `player.death` | event | agent | stable | 1.1.0 | `killer` · subject · optional | A player died. Pals dying are not reported. killer is a full subject when another player did it; attribution is best-effort. |
| `player.leave` | event | agent | stable | 1.1.0 | `source` · string | A player disconnected. No hookable disconnect exists on this loader, so the agent notices by watching who is still in the world and reports it within a few seconds rather than instantly. |
| `player.message` | action | agent | stable | 1.1.0 | `text` · string · required | Send a private system-chat message to one online player. |
| `player.give_item` | action | agent | stable | 1.1.0 | `item` · item_id · required<br>`count` · int · default 1 · 1…9999 | Put items into an online player's inventory. Item ids are the game's internal names (bread is Pan); an unknown id is accepted by the game and silently does nothing. |
| `player.teleport` | action | agent | experimental | 2.0.0 | `x` · number · required<br>`y` · number · required<br>`z` · number · required | Teleport an online player to world coordinates. Uses the engine's own placement call, then reads the position back — an ok carries where the player actually landed, and a teleport that did not move anyone fails rather than reporting success. |
| `player.heal` | action | agent | experimental | 2.0.0 | _none_ | Restore an online player to full: HP back to maximum and a full stomach, shield included where the build exposes it. Reports which of the three actually moved, and why any of them did not. |
| `player.count_item` | query | agent | experimental | 2.0.0 | `item` · item_id · required | How many of an item an online player carries. Money is the item id for gold. |
| `player.has_item` | query | agent | experimental | 2.0.0 | `item` · item_id · required<br>`count` · int · default 1 · 1…999999 | Whether an online player carries at least `count` of an item. |
| `player.set_tag` | action | agent | stable | 2.0.0 | `key` · string · required<br>`value` · string · required | Attach a key/value to a player, kept in the daemon's database across restarts. The persistence primitive for 'already got the kit', ranks, notes. |
| `player.get_tag` | query | agent | stable | 2.0.0 | `key` · string · required | Read one of a player's tags. ok with value null when the tag is unset. |
| `player.delete_tag` | action | agent | stable | 2.0.0 | `key` · string · required | Remove a tag from a player. |
| `player.position` | query | agent | stable | 2.1.0 | _none_ | The online player's exact world position (Engine Actor location, includes z). |
| `player.stats` | query | agent | experimental | 2.5.0 | _none_ | Read an online player's stats — hp/maxHp, hunger/maxHunger, shield/maxShield, sanity, plus level, rank, talent* IVs and rank* soul upgrades from the save parameter. A stat this build does not expose comes back null rather than absent. |
| `player.set_stats` | action | agent | experimental | 2.5.0 | `hp` · number · 0…100000000<br>`maxHp` · number · 1…100000000<br>`hunger` · number · 0…1000<br>`shield` · number · 0…100000<br>`maxShield` · number · 1…100000<br>`level` · int · 1…100<br>`rank` · int · 1…5<br>`talentHp` · int · 0…100<br>`talentMelee` · int · 0…100<br>`talentShot` · int · 0…100<br>`talentDefense` · int · 0…100<br>`rankAttack` · int · 0…10<br>`rankDefence` · int · 0…10<br>`rankCraftSpeed` · int · 0…10 | Set any combination of an online player's stats in one call; omitted fields are left alone. Values are absolute, on the same scale player.stats reports — hp is converted to the rate the engine wants using the maximum it reports; asking for more HP than the maximum raises the maximum with it. Combat and work stats (level, rank, talent* IVs, rank* soul upgrades) are written to the save parameter and replicated — they are pal stats, and a player character is refused them rather than told they applied (player.status_point is the equivalent). Every write is read back: applied lists what changed, unverified what the engine accepted without visibly changing, failed what it refused. |
| `player.status_points` | query | agent | experimental | 3.1.0 | _none_ | An online player's status points — the allocation the game computes their max HP, stamina, attack and carry weight from. Names are the game's own; the ones this build answers for are what comes back. |
| `player.status_point` | action | agent | experimental | 3.1.0 | `stat` · string · required<br>`points` · int · default 1 · 1…1000 | Spend status points on one of a player's stats, the way a level-up does. This is how a player's max HP goes up: it is computed from the points, not stored, so nothing else can raise it. Additive. stat is the game's own FName for the stat and is passed through verbatim — this build spends through the player controller and exposes no way to read the allocation back, so the result reports which readable stat moved instead. player.status_points lists the names to try. |

## npc.*

| Type | Kind | Runtime | Stability | Since | Fields | Summary |
|---|---|---|---|---|---|---|
| `npc.spawn` | event | agent | experimental | 2.0.0 | `species` · string<br>`level` · int<br>`rare` · bool | A pal/NPC finished parameter initialisation — fires on world spawns near players. Player characters are filtered out. Throttled to 20 events per second. |

## pal.*

| Type | Kind | Runtime | Stability | Since | Fields | Summary |
|---|---|---|---|---|---|---|
| `pal.spawn` | action | agent | experimental | 2.0.0 | `species` · item_id · required<br>`level` · int · default 10 · 1…100<br>`rare` · bool · default false<br>`traits` · string<br>`x` · number<br>`y` · number<br>`z` · number<br>`hostile` · bool · default false | Spawn a pal, at explicit coordinates or beside a target player. One of the two is required; with coordinates the pal is placed there and the result reports where it landed. Level, rarity and passive-skill traits apply on spawn. hostile=true additionally turns the new pal on the target player through pal.aggro and reports whether that took. Spawns are not part of the world save: a server restart removes them. The result carries the new pal's id. |
| `pal.list` | query | agent | experimental | 2.2.0 | _none_ | Pals currently loaded in the world (players excluded), with species, level and — when the engine exposes it — a stable id usable as a pal.set_hp target. Capped at 100 rows; count reports the true total. |
| `pal.stats` | query | agent | experimental | 2.5.0 | `pal` · string · required | Read a loaded pal's stats, targeting the id from pal.list or a pal.spawn result — including level, rank, talent* IVs and rank* soul upgrades. |
| `pal.set_stats` | action | agent | experimental | 2.5.0 | `pal` · string · required<br>`hp` · number · 0…100000000<br>`maxHp` · number · 1…100000000<br>`hunger` · number · 0…1000<br>`shield` · number · 0…100000<br>`maxShield` · number · 1…100000<br>`level` · int · 1…100<br>`rank` · int · 1…5<br>`talentHp` · int · 0…100<br>`talentMelee` · int · 0…100<br>`talentShot` · int · 0…100<br>`talentDefense` · int · 0…100<br>`rankAttack` · int · 0…10<br>`rankDefence` · int · 0…10<br>`rankCraftSpeed` · int · 0…10 | Set any combination of a loaded pal's stats in one call; omitted fields are left alone. Values are absolute, on the same scale pal.stats reports — hp is converted to the rate the engine wants using the maximum it reports; asking for more HP than the maximum raises the maximum with it. Combat and work stats (level, rank, talent* IVs, rank* soul upgrades) are written to the save parameter and replicated — they are pal stats, and a player character is refused them rather than told they applied (player.status_point is the equivalent). Every write is read back: applied lists what changed, unverified what the engine accepted without visibly changing, failed what it refused. |
| `pal.aggro` | action | agent | experimental | 2.7.0 | `pal` · string · required<br>`amount` · int · default 1000 · 1…100000 | Make a loaded pal hate a player, so it turns on them and fights. The hate system itself is not callable on this build, so the pal, its controller and its parameter component are searched for a hate function that is, and the engine's own damage path is the last resort. The result names the call that worked; a failure lists the hate-related functions this build does expose. |
| `pal.inspect` | query | agent | experimental | 2.8.0 | `pal` · string · required | Diagnostic dump for one loaded pal: its AI controller class, whether a player owns it, otomo flag, spawned type, and whether a hate system exists on it (which is not the same as it hating anyone). Run it on a wild pal and on a spawned one — the difference is why one fights back and the other does not. |
| `pal.force_spawn` | action | agent | experimental | 2.9.0 | `kind` · string · default "nearest"<br>`radius` · number · default 50000 · 0…1000000 | Ask one of the world's own spawners near the player to fire. Unlike pal.spawn this does not construct an NPC by hand — the game spawns it through its normal path, so it gets the AI a wild pal has and will fight back. kind=boss prefers a boss/alpha spawner (hostile by design), anything else takes the nearest. radius is in world units, where 100 units is one metre. The spawner decides species and location, not you. |

## server.*

| Type | Kind | Runtime | Stability | Since | Fields | Summary |
|---|---|---|---|---|---|---|
| `server.announce` | action | game-rest | stable | 1.0.0 | `message` · string · required | Broadcast a message to everyone online, via the game's own REST API. |

## permission.*

| Type | Kind | Runtime | Stability | Since | Fields | Summary |
|---|---|---|---|---|---|---|
| `permission.register` | action | agent | stable | 2.1.0 | `mod` · string · required<br>`node` · string · required<br>`description` · string<br>`default` · string | A mod registers one permission node it owns, namespaced by its name, with a description and a default effect. Idempotent, and an operator's change to the default in permissions.config outranks it. |
| `permission.check` | query | agent | stable | 2.1.0 | `node` · string · required | May this player do this? Resolves user overrides, then groups by weight, then the default group, then the node's default; deny beats allow. Any parameter beyond `node` is taken as the call being asked about and matched against the winning entry's constraint — 'may spawn, but only Lamball' is one node plus a constraint. |
| `permission.grant` | action | agent | stable | 2.1.0 | `node` · string · required<br>`effect` · string · default "allow"<br>`constraints` · json | Set a per-player override: allow or deny a node for this player, optionally constrained ({"species":{"in":[…]}}, {"x":{"min":0,"max":1000}}). Player overrides beat every group. |
| `permission.revoke` | action | agent | stable | 2.1.0 | `node` · string · required | Remove a per-player override, so groups decide again. |
| `permission.nodes` | query | agent | stable | 2.1.0 | _none_ | Every registered node, grouped by the mod that registered it, with defaults. |
| `permission.player` | query | agent | stable | 2.1.0 | _none_ | A player's permission state: their groups, their overrides, and their role tag. |

## group.*

| Type | Kind | Runtime | Stability | Since | Fields | Summary |
|---|---|---|---|---|---|---|
| `group.create` | action | agent | stable | 2.1.0 | `name` · item_id · required<br>`tag` · string<br>`weight` · int · default 0 · 0…1000 | Create a permission group. tag is the [ROLE] shown in chat when enabled; weight orders groups when a player has several (highest wins). |
| `group.update` | action | agent | stable | 2.1.0 | `name` · item_id · required<br>`tag` · string<br>`weight` · int · default 0 · 0…1000 | Change a group's tag or weight. |
| `group.delete` | action | agent | stable | 2.1.0 | `name` · item_id · required | Delete a group (the default group cannot be deleted). |
| `group.set_entry` | action | agent | stable | 2.1.0 | `group` · item_id · required<br>`node` · string · required<br>`effect` · string · default "allow"<br>`constraints` · json | Set one node entry on a group: allow or deny, optionally constrained. Wildcards work ('chatshop.*', '*'). |
| `group.remove_entry` | action | agent | stable | 2.1.0 | `group` · item_id · required<br>`node` · string · required | Remove a node entry from a group. |
| `group.assign` | action | agent | stable | 2.1.0 | `group` · item_id · required | Put a player into a group. |
| `group.unassign` | action | agent | stable | 2.1.0 | `group` · item_id · required | Take a player out of a group. |
| `group.list` | query | agent | stable | 2.1.0 | _none_ | All groups with their entries, weights, tags and member counts. |

## location.*

| Type | Kind | Runtime | Stability | Since | Fields | Summary |
|---|---|---|---|---|---|---|
| `location.save` | action | agent | stable | 2.1.0 | `name` · string · required<br>`x` · number · required<br>`y` · number · required<br>`z` · number · required | Save a named world location for the teleport picker. Stand somewhere, read player.position, save it — fast-travel points, arenas, meeting spots. |
| `location.list` | query | agent | stable | 2.1.0 | _none_ | Saved locations plus boss-spawn positions observed live (source: manual | boss). |
| `location.delete` | action | agent | stable | 2.1.0 | `name` · string · required | Remove a saved location. |

## data.*

| Type | Kind | Runtime | Stability | Since | Fields | Summary |
|---|---|---|---|---|---|---|
| `data.collections` | query | agent | experimental | 3.2.0 | _none_ | Every collection the agent and its mods have declared, with its owner, storage class and field shape — enough to render one this caller has never heard of. |
| `data.list` | query | agent | experimental | 3.2.0 | `collection` · string · required | Every record in one collection, by its qualified name (owner.name). |
| `data.get` | query | agent | experimental | 3.2.0 | `collection` · string · required<br>`record` · string · required | One record from a collection. ok with record null when it is not there. |
| `data.set` | action | agent | experimental | 3.2.0 | `collection` · string · required<br>`record` · string · required | Write one record. Every parameter beyond collection and record becomes a field on it, so the call carries the shape the collection declared. List-valued fields cannot be set this way yet. |
| `data.delete` | action | agent | experimental | 3.2.0 | `collection` · string · required<br>`record` · string · required | Remove one record from a collection. |
