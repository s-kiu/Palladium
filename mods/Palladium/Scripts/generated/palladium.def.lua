---@meta
-- Generated from packages/shared/bridge-capabilities.json — do not edit. Regenerate: node packages/shared/generate.mjs
--
-- Editor types only: lua-language-server reads this and offers the real
-- capabilities while a mod is being written. Nothing loads it at runtime.

---@class PalSubject
---@field kind string
---@field id string
---@field name string|nil

---@class PalEvent
---@field type string
---@field at integer
---@field subject PalSubject
---@field data table

---@class PlayerMessageParams
---@field text string

---@class PlayerGiveItemParams
---@field item string # an item id, not the shown name
---@field count? integer

---@class PlayerTeleportParams
---@field x? number
---@field y? number
---@field z? number
---@field to? string

---@class PlayerHealParams

---@class PlayerCountItemParams
---@field item string # an item id, not the shown name

---@class PlayerHasItemParams
---@field item string # an item id, not the shown name
---@field count? integer

---@class PalSpawnParams
---@field species string # an item id, not the shown name
---@field level? integer
---@field rare? boolean
---@field traits? string
---@field x? number
---@field y? number
---@field z? number
---@field hostile? boolean

---@class PlayerSetTagParams
---@field key string
---@field value string

---@class PlayerGetTagParams
---@field key string

---@class PlayerDeleteTagParams
---@field key string

---@class ServerAnnounceParams
---@field message string

---@class PermissionRegisterParams
---@field mod string
---@field node string
---@field description? string
---@field default? string

---@class PermissionCheckParams
---@field node string
---@field target? string

---@class PermissionGrantParams
---@field node string
---@field effect? string
---@field constraints? table
---@field until? string
---@field where? string

---@class PermissionRevokeParams
---@field node string

---@class PermissionNodesParams

---@class PermissionPlayerParams

---@class GroupCreateParams
---@field name string # an item id, not the shown name
---@field tag? string
---@field weight? integer

---@class GroupUpdateParams
---@field name string # an item id, not the shown name
---@field tag? string
---@field weight? integer

---@class GroupDeleteParams
---@field name string # an item id, not the shown name

---@class GroupSetEntryParams
---@field group string # an item id, not the shown name
---@field node string
---@field effect? string
---@field constraints? table
---@field until? string
---@field where? string

---@class GroupRemoveEntryParams
---@field group string # an item id, not the shown name
---@field node string

---@class GroupAssignParams
---@field group string # an item id, not the shown name

---@class GroupUnassignParams
---@field group string # an item id, not the shown name

---@class GroupListParams

---@class PlayerPositionParams

---@class LocationSaveParams
---@field name string
---@field x number
---@field y number
---@field z number

---@class LocationListParams

---@class LocationDeleteParams
---@field name string

---@class PalListParams

---@class PlayerStatsParams

---@class PlayerSetStatsParams
---@field hp? number
---@field maxHp? number
---@field hunger? number
---@field shield? number
---@field maxShield? number
---@field level? integer
---@field rank? integer
---@field talentHp? integer
---@field talentMelee? integer
---@field talentShot? integer
---@field talentDefense? integer
---@field rankAttack? integer
---@field rankDefence? integer
---@field rankCraftSpeed? integer

---@class PlayerSetImmortalParams
---@field on? boolean

---@class PlayerSetFrozenParams
---@field on? boolean

---@class PlayerSetFlyingParams
---@field on? boolean

---@class PlayerStatusPointsParams

---@class PlayerStatusPointParams
---@field stat string
---@field points? integer

---@class PlayerPlaytimeParams

---@class PalStatsParams
---@field pal string

---@class PalSetStatsParams
---@field pal string
---@field hp? number
---@field maxHp? number
---@field hunger? number
---@field shield? number
---@field maxShield? number
---@field level? integer
---@field rank? integer
---@field talentHp? integer
---@field talentMelee? integer
---@field talentShot? integer
---@field talentDefense? integer
---@field rankAttack? integer
---@field rankDefence? integer
---@field rankCraftSpeed? integer

---@class PalAggroParams
---@field pal string
---@field amount? integer
---@field sight? boolean

---@class PalInspectParams
---@field pal string

---@class PalSpawnWildParams
---@field species? string # an item id, not the shown name
---@field level? integer
---@field aggressive? boolean
---@field kind? string
---@field radius? number

---@class PalForceSpawnParams
---@field species? string # an item id, not the shown name
---@field level? integer
---@field aggressive? boolean
---@field kind? string
---@field radius? number

---@class BridgeProbeParams
---@field on? string
---@field pal? string
---@field filter? string

---@class DataCollectionsParams

---@class DataListParams
---@field collection string

---@class DataGetParams
---@field collection string
---@field record string

---@class DataSetParams
---@field collection string
---@field record string

---@class DataDeleteParams
---@field collection string
---@field record string

---@class PalPlayer
---@field message fun(target: string, params: PlayerMessageParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Send a private system-chat message to one online player.
---@field give_item fun(target: string, params: PlayerGiveItemParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Hand items to a player. The count is read before and after, so the result says whether they arrived: an unknown item id is reported as a failure rather than a success that added nothing.
---@field teleport fun(target: string, params: PlayerTeleportParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Move an online player. The destination is x/y/z coordinates, or another player: `to` names one and their position is the target — in chat, `!teleport to=@Name` is 'take me to them' and `!teleport @Name to=@me` is 'bring them here'. The result reports where they actually landed; a move that went nowhere is a failure, not a success.
---@field heal fun(target: string, params: PlayerHealParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Restore an online player to full: HP back to maximum and a full stomach, shield included where the build exposes it. Reports which of the three actually moved, and why any of them did not.
---@field count_item fun(target: string, params: PlayerCountItemParams, done?: fun(ok: boolean, err: string|nil, data: table)) # How many of an item an online player carries. Money is the item id for gold.
---@field has_item fun(target: string, params: PlayerHasItemParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Whether an online player carries at least `count` of an item.
---@field set_tag fun(target: string|nil, params: PlayerSetTagParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Attach a key/value to a player, kept by the agent across restarts. The persistence primitive for 'already got the kit', ranks, notes.
---@field get_tag fun(target: string|nil, params: PlayerGetTagParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Read one of a player's tags. ok with value null when the tag is unset.
---@field delete_tag fun(target: string|nil, params: PlayerDeleteTagParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Remove a tag from a player.
---@field position fun(target: string, params: PlayerPositionParams, done?: fun(ok: boolean, err: string|nil, data: table)) # The online player's exact world position (Engine Actor location, includes z).
---@field stats fun(target: string, params: PlayerStatsParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Read an online player's stats — hp/maxHp, hunger/maxHunger, shield/maxShield, sanity, plus level, rank, talent* IVs and rank* soul upgrades from the save parameter. A stat this build does not expose comes back null rather than absent.
---@field set_stats fun(target: string, params: PlayerSetStatsParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Set any combination of an online player's stats in one call; omitted fields are left alone. Values are absolute, on the same scale player.stats reports — hp is converted to the rate the engine wants using the maximum it reports; asking for more HP than the maximum raises the maximum with it. Combat and work stats (level, rank, talent* IVs, rank* soul upgrades) are written to the save parameter and replicated — they are pal stats, and a player character is refused them rather than told they applied (player.status_point is the equivalent). Every write is read back: applied lists what changed, unverified what the engine accepted without visibly changing, failed what it refused.
---@field set_immortal fun(target: string, params: PlayerSetImmortalParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Make a player unkillable, or mortal again. Raises DefenseUp so almost nothing gets through, and refills health and stomach on the agent's tick as a backstop; their own defence is remembered and handed back. Stamina is deliberately untouched — the client draws that bar from its own simulation, so a server-side refill only fights it.
---@field set_frozen fun(target: string, params: PlayerSetFrozenParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Hold a player still, or let them go. Movement is simulated on the player's own machine, so a server-side speed of zero does not stop them; the agent anchors them instead and puts them back when they move more than a step. Enforcement rather than prevention: a frozen player can take that step before being returned.
---@field set_flying fun(target: string, params: PlayerSetFlyingParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Ask a player's game to start or end flight. The server cannot fly a player on its own — flight is a mode the client enters — so this sends an instruction the optional AdminControlsClient mod acts on. Unverified by design: nothing reports flight back, and without the client mod installed nothing happens.
---@field status_points fun(target: string, params: PlayerStatusPointsParams, done?: fun(ok: boolean, err: string|nil, data: table)) # An online player's status points — the allocation the game computes their max HP, stamina, attack and carry weight from. Names are the game's own; the ones this build answers for are what comes back.
---@field status_point fun(target: string, params: PlayerStatusPointParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Spend status points on one of a player's stats, the way a level-up does. This is how a player's max HP goes up: it is computed from the points, not stored, so nothing else can raise it. Additive. stat is the game's own FName for the stat and is passed through verbatim — this build spends through the player controller and exposes no way to read the allocation back, so the result reports which readable stat moved instead. player.status_points lists the names to try.
---@field playtime fun(target: string|nil, params: PlayerPlaytimeParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Minutes a player has actually spent on this server, credited one minute at a time while they are online — a crash costs at most the minute in progress. Also reports the current session's minutes and whether they are online right now. Answers for offline players too: the total is history, not presence.

---@class PalPal
---@field spawn fun(target: string|nil, params: PalSpawnParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Spawn a pal, at explicit coordinates or beside a target player. One of the two is required; with coordinates the pal is placed there and the result reports where it landed. Level, rarity and passive-skill traits apply on spawn. hostile=true additionally turns the new pal on the target player through pal.aggro and reports whether that took. Spawns are not part of the world save: a server restart removes them. The result carries the new pal's id.
---@field list fun(params: PalListParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Pals currently loaded in the world (players excluded), with species, level and — when the engine exposes it — a stable id usable as a pal.set_hp target. Capped at 100 rows; count reports the true total.
---@field stats fun(params: PalStatsParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Read a loaded pal's stats, targeting the id from pal.list or a pal.spawn result — including level, rank, talent* IVs and rank* soul upgrades.
---@field set_stats fun(params: PalSetStatsParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Set any combination of a loaded pal's stats in one call; omitted fields are left alone. Values are absolute, on the same scale pal.stats reports — hp is converted to the rate the engine wants using the maximum it reports; asking for more HP than the maximum raises the maximum with it. Combat and work stats (level, rank, talent* IVs, rank* soul upgrades) are written to the save parameter and replicated — they are pal stats, and a player character is refused them rather than told they applied (player.status_point is the equivalent). Every write is read back: applied lists what changed, unverified what the engine accepted without visibly changing, failed what it refused.
---@field aggro fun(target: string, params: PalAggroParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Make a loaded pal hate a player, so it turns on them and fights. The hate system itself is not callable on this build, so the pal, its controller and its parameter component are searched for a hate function that is, and the engine's own damage path is the last resort. The result names the call that worked; a failure lists the hate-related functions this build does expose. sight=true additionally flips the pal's sensor temperament to attack-on-sight — it then goes for anyone who comes close, not only the caller.
---@field inspect fun(params: PalInspectParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Diagnostic dump for one loaded pal: its AI controller class, whether a player owns it, otomo flag, spawned type, and whether a hate system exists on it (which is not the same as it hating anyone). Run it on a wild pal and on a spawned one — the difference is why one fights back and the other does not.
---@field spawn_wild fun(target: string, params: PalSpawnWildParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Spawn a real wild pal: one of the world's own spawners near the player fires, so the game itself wires the newcomer — controller, wild group, combat permission. With a species, the spawner's lottery is rewritten for the shot and restored right after; aggressive=true also sets the newcomer's temperament to attack-on-sight. Without a species the spawner rolls its own table; kind=boss prefers an alpha spawner. Contrast pal.spawn, which places a hand-made pal at exact coordinates but outside the world's own wiring.
---@field force_spawn fun(target: string, params: PalForceSpawnParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Deprecated alias of pal.spawn_wild — same behavior, kept so existing scripts keep working.

---@class PalServer
---@field announce fun(params: ServerAnnounceParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Tell everyone online something, as system chat. The agent sends it to each player itself, so a mod in the game can announce without anything outside it.

---@class PalPermission
---@field register fun(params: PermissionRegisterParams, done?: fun(ok: boolean, err: string|nil, data: table)) # A mod registers one permission node it owns, namespaced by its name, with a description and a default effect. Idempotent, and an operator's change to the default in permissions.config outranks it.
---@field check fun(target: string|nil, params: PermissionCheckParams, done?: fun(ok: boolean, err: string|nil, data: table)) # May this player do this? Resolves user overrides, then groups by weight, then the default group, then the node's default; deny beats allow. Any parameter beyond `node` is taken as the call being asked about and matched against the winning entry's constraint — 'may spawn, but only Lamball' is one node plus a constraint.
---@field grant fun(target: string|nil, params: PermissionGrantParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Set a per-player override: allow or deny a node for this player, optionally constrained ({"species":{"in":[…]}}, {"x":{"min":0,"max":1000}}). Player overrides beat every group.
---@field revoke fun(target: string|nil, params: PermissionRevokeParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Remove a per-player override, so groups decide again.
---@field nodes fun(params: PermissionNodesParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Every registered node, grouped by the mod that registered it, with defaults.
---@field player fun(target: string|nil, params: PermissionPlayerParams, done?: fun(ok: boolean, err: string|nil, data: table)) # A player's permission state: their groups, their overrides, and their role tag.

---@class PalGroup
---@field create fun(params: GroupCreateParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Create a permission group. tag is the [ROLE] shown in chat when enabled; weight orders groups when a player has several (highest wins).
---@field update fun(params: GroupUpdateParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Change a group's tag or weight.
---@field delete fun(params: GroupDeleteParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Delete a group (the default group cannot be deleted).
---@field set_entry fun(params: GroupSetEntryParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Set one node entry on a group: allow or deny, optionally constrained. Wildcards work ('chatshop.*', '*').
---@field remove_entry fun(params: GroupRemoveEntryParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Remove a node entry from a group.
---@field assign fun(target: string|nil, params: GroupAssignParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Put a player into a group.
---@field unassign fun(target: string|nil, params: GroupUnassignParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Take a player out of a group.
---@field list fun(params: GroupListParams, done?: fun(ok: boolean, err: string|nil, data: table)) # All groups with their entries, weights, tags and member counts.

---@class PalLocation
---@field save fun(params: LocationSaveParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Save a named world location for the teleport picker. Stand somewhere, read player.position, save it — fast-travel points, arenas, meeting spots.
---@field list fun(params: LocationListParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Saved locations plus boss-spawn positions observed live (source: manual | boss).
---@field delete fun(params: LocationDeleteParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Remove a saved location.

---@class PalBridge
---@field probe fun(target: string|nil, params: BridgeProbeParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Which engine functions and properties this build actually exposes on an object, narrowed by substring. Reads the class chain through reflection and calls nothing, so it is safe to point anywhere. This is the answer to a not_supported: it names what does exist, fields included — a value the engine keeps in a property rather than behind a getter is invisible to a function list alone. on: player | state | controller | params | pal | palai | palparams | utility | manager | spawner, or class:<UClassName> for any live object by its class.

---@class PalData
---@field collections fun(params: DataCollectionsParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Every collection the agent and its mods have declared, with its owner, storage class and field shape — enough to render one this caller has never heard of.
---@field list fun(params: DataListParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Every record in one collection, by its qualified name (owner.name).
---@field get fun(params: DataGetParams, done?: fun(ok: boolean, err: string|nil, data: table)) # One record from a collection. ok with record null when it is not there.
---@field set fun(params: DataSetParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Write one record. Every parameter beyond collection and record becomes a field on it, so the call carries the shape the collection declared. List-valued fields cannot be set this way yet.
---@field delete fun(params: DataDeleteParams, done?: fun(ok: boolean, err: string|nil, data: table)) # Remove one record from a collection.

---@class Pal
---@field name string
---@field settings table
---@field player PalPlayer
---@field pal PalPal
---@field server PalServer
---@field permission PalPermission
---@field group PalGroup
---@field location PalLocation
---@field bridge PalBridge
---@field data PalData
---@field log fun(text: any)
---@field call fun(action: string, userid: string|nil, params: table, done?: fun(ok: boolean, err: string|nil, data: table))
---@field can fun(userid: string, node: string, params?: table): boolean
---@field tag fun(userid: string, key: string): string|nil
---@field set_tag fun(userid: string, key: string, value: any): boolean
---@field delete_tag fun(userid: string, key: string): boolean
---@field data fun(collection: string): table
---@field player_by_name fun(name: string): string|nil

-- Event types this build publishes:
--   bridge.ready — agent: string, version: string, envelope: integer
--   bridge.hook — hook: string, target: string, ok: boolean
--   player.chat — message: string
--   player.join — firstThisRun: boolean, firstEver: boolean, firstSeen: integer, joins: integer
--   player.respawn
--   player.death — killer: PalSubject
--   player.leave — source: string
--   npc.spawn — species: string, level: integer, rare: boolean
--   player.hour — hours: integer, minutes: integer
--   clock.minute — date: string, weekday: string, hour: integer, minute: integer
--   clock.day — date: string, weekday: string
--   player.item_use — count: integer, slot: string, target: string
