// Generated from packages/shared/bridge-capabilities.json — do not edit. Regenerate: node packages/shared/generate.mjs

/** Who or what an event is about. */
export interface Subject {
  kind: string;
  id: string;
  name?: string;
}

/** What every call answers with. Game-level failure is `ok: false`, not a throw. */
export interface Envelope<T> {
  ok: boolean;
  error?: string;
  data: T;
  id?: string;
  at?: number;
  type?: string;
}

/** Send a private system-chat message to one online player. */
export interface PlayerMessageParams {
  text: string;
}
export interface PlayerMessageResult {
}

/** Hand items to a player. The count is read before and after, so the result says whether they arrived: an unknown item id is reported as a failure rather than a success that added nothing. */
export interface PlayerGiveItemParams {
  item: string;
  count?: number;
}
export interface PlayerGiveItemResult {
  item: string;
  count: number;
  delivered: boolean;
  gained: number;
}

/** Move an online player. The destination is x/y/z coordinates, or another player: `to` names one and their position is the target — in chat, `!teleport to=@Name` is 'take me to them' and `!teleport @Name to=@me` is 'bring them here'. The result reports where they actually landed; a move that went nowhere is a failure, not a success. */
export interface PlayerTeleportParams {
  x?: number;
  y?: number;
  z?: number;
  to?: string;
}
export interface PlayerTeleportResult {
  x: number;
  y: number;
  z: number;
  via: string;
}

/** Restore an online player to full: HP back to maximum and a full stomach, shield included where the build exposes it. Reports which of the three actually moved, and why any of them did not. */
export interface PlayerHealParams {
}
export interface PlayerHealResult {
  applied: string;
  failed: string;
  detail: string;
  stats: unknown;
}

/** How many of an item an online player carries. Money is the item id for gold. */
export interface PlayerCountItemParams {
  item: string;
}
export interface PlayerCountItemResult {
  item: string;
  count: number;
}

/** Whether an online player carries at least `count` of an item. */
export interface PlayerHasItemParams {
  item: string;
  count?: number;
}
export interface PlayerHasItemResult {
  item: string;
  has: boolean;
  count: number;
}

/** Spawn a pal, at explicit coordinates or beside a target player. One of the two is required; with coordinates the pal is placed there and the result reports where it landed. Level, rarity and passive-skill traits apply on spawn. hostile=true additionally turns the new pal on the target player through pal.aggro and reports whether that took. Spawns are not part of the world save: a server restart removes them. The result carries the new pal's id. */
export interface PalSpawnParams {
  species: string;
  level?: number;
  rare?: boolean;
  traits?: string;
  x?: number;
  y?: number;
  z?: number;
  hostile?: boolean;
}
export interface PalSpawnResult {
  pal: string;
  species: string;
  level: number;
  x: number;
  y: number;
  z: number;
  hostile: boolean;
  controller: string;
  aggro: string;
}

/** Attach a key/value to a player, kept by the agent across restarts. The persistence primitive for 'already got the kit', ranks, notes. */
export interface PlayerSetTagParams {
  key: string;
  value: string;
}
export interface PlayerSetTagResult {
  key: string;
  value: string;
}

/** Read one of a player's tags. ok with value null when the tag is unset. */
export interface PlayerGetTagParams {
  key: string;
}
export interface PlayerGetTagResult {
  key: string;
  value: string | null;
}

/** Remove a tag from a player. */
export interface PlayerDeleteTagParams {
  key: string;
}
export interface PlayerDeleteTagResult {
  key: string;
}

/** Tell everyone online something, as system chat. The agent sends it to each player itself, so a mod in the game can announce without anything outside it. */
export interface ServerAnnounceParams {
  message: string;
}
export interface ServerAnnounceResult {
  players: number;
}

/** A mod registers one permission node it owns, namespaced by its name, with a description and a default effect. Idempotent, and an operator's change to the default in permissions.config outranks it. */
export interface PermissionRegisterParams {
  mod: string;
  node: string;
  description?: string;
  default?: string;
}
export interface PermissionRegisterResult {
  node: string;
}

/** May this player do this? Resolves user overrides, then groups by weight, then the default group, then the node's default; deny beats allow. Any parameter beyond `node` is taken as the call being asked about and matched against the winning entry's constraint — 'may spawn, but only Lamball' is one node plus a constraint. */
export interface PermissionCheckParams {
  node: string;
  target?: string;
}
export interface PermissionCheckResult {
  allowed: boolean;
  source: string;
  constraints: string;
  violation: string;
}

/** Set a per-player override: allow or deny a node for this player, optionally constrained ({"species":{"in":[…]}}, {"x":{"min":0,"max":1000}}). Player overrides beat every group. */
export interface PermissionGrantParams {
  node: string;
  effect?: string;
  constraints?: unknown;
  until?: string;
  where?: string;
}
export interface PermissionGrantResult {
  node: string;
  effect: string;
}

/** Remove a per-player override, so groups decide again. */
export interface PermissionRevokeParams {
  node: string;
}
export interface PermissionRevokeResult {
  node: string;
}

/** Every registered node, grouped by the mod that registered it, with defaults. */
export interface PermissionNodesParams {
}
export interface PermissionNodesResult {
  nodes: unknown;
}

/** A player's permission state: their groups, their overrides, and their role tag. */
export interface PermissionPlayerParams {
}
export interface PermissionPlayerResult {
  groups: unknown;
  entries: unknown;
  role: string | null;
}

/** Create a permission group. tag is the [ROLE] shown in chat when enabled; weight orders groups when a player has several (highest wins). */
export interface GroupCreateParams {
  name: string;
  tag?: string;
  weight?: number;
}
export interface GroupCreateResult {
  name: string;
}

/** Change a group's tag or weight. */
export interface GroupUpdateParams {
  name: string;
  tag?: string;
  weight?: number;
}
export interface GroupUpdateResult {
  name: string;
}

/** Delete a group (the default group cannot be deleted). */
export interface GroupDeleteParams {
  name: string;
}
export interface GroupDeleteResult {
  name: string;
}

/** Set one node entry on a group: allow or deny, optionally constrained. Wildcards work ('chatshop.*', '*'). */
export interface GroupSetEntryParams {
  group: string;
  node: string;
  effect?: string;
  constraints?: unknown;
  until?: string;
  where?: string;
}
export interface GroupSetEntryResult {
  group: string;
  node: string;
}

/** Remove a node entry from a group. */
export interface GroupRemoveEntryParams {
  group: string;
  node: string;
}
export interface GroupRemoveEntryResult {
  group: string;
  node: string;
}

/** Put a player into a group. */
export interface GroupAssignParams {
  group: string;
}
export interface GroupAssignResult {
  group: string;
}

/** Take a player out of a group. */
export interface GroupUnassignParams {
  group: string;
}
export interface GroupUnassignResult {
  group: string;
}

/** All groups with their entries, weights, tags and member counts. */
export interface GroupListParams {
}
export interface GroupListResult {
  groups: unknown;
}

/** The online player's exact world position (Engine Actor location, includes z). */
export interface PlayerPositionParams {
}
export interface PlayerPositionResult {
  x: number;
  y: number;
  z: number;
}

/** Save a named world location for the teleport picker. Stand somewhere, read player.position, save it — fast-travel points, arenas, meeting spots. */
export interface LocationSaveParams {
  name: string;
  x: number;
  y: number;
  z: number;
}
export interface LocationSaveResult {
  name: string;
}

/** Saved locations plus boss-spawn positions observed live (source: manual | boss). */
export interface LocationListParams {
}
export interface LocationListResult {
  locations: unknown;
}

/** Remove a saved location. */
export interface LocationDeleteParams {
  name: string;
}
export interface LocationDeleteResult {
  name: string;
}

/** Pals currently loaded in the world (players excluded), with species, level and — when the engine exposes it — a stable id usable as a pal.set_hp target. Capped at 100 rows; count reports the true total. */
export interface PalListParams {
}
export interface PalListResult {
  count: number;
  truncated: boolean;
  pals: unknown;
}

/** Read an online player's stats — hp/maxHp, hunger/maxHunger, shield/maxShield, sanity, plus level, rank, talent* IVs and rank* soul upgrades from the save parameter. A stat this build does not expose comes back null rather than absent. */
export interface PlayerStatsParams {
}
export interface PlayerStatsResult {
  level: number;
  hp: number;
  maxHp: number;
  stats: unknown;
}

/** Set any combination of an online player's stats in one call; omitted fields are left alone. Values are absolute, on the same scale player.stats reports — hp is converted to the rate the engine wants using the maximum it reports; asking for more HP than the maximum raises the maximum with it. Combat and work stats (level, rank, talent* IVs, rank* soul upgrades) are written to the save parameter and replicated — they are pal stats, and a player character is refused them rather than told they applied (player.status_point is the equivalent). Every write is read back: applied lists what changed, unverified what the engine accepted without visibly changing, failed what it refused. */
export interface PlayerSetStatsParams {
  hp?: number;
  maxHp?: number;
  hunger?: number;
  shield?: number;
  maxShield?: number;
  level?: number;
  rank?: number;
  talentHp?: number;
  talentMelee?: number;
  talentShot?: number;
  talentDefense?: number;
  rankAttack?: number;
  rankDefence?: number;
  rankCraftSpeed?: number;
}
export interface PlayerSetStatsResult {
  applied: string;
  unverified: string;
  failed: string;
  detail: string;
  stats: unknown;
}

/** Make a player unkillable, or mortal again. Sets the engine's IsImmortality flag and zeroes the rate at which enemies inflict damage on them — the flag holds on this build but the damage path does not consult it, so the rate is what does the work. Both are read back. */
export interface PlayerSetImmortalParams {
  on?: boolean;
}
export interface PlayerSetImmortalResult {
  immortal: boolean;
  was: boolean;
  damage_rate: string;
  damage_rate_was: string;
}

/** Hold a player still, or let them go. Pins the engine's own walk-speed multiplier to zero under a Palladium-owned flag name, so releasing it restores whatever the game had rather than a guess at normal. The multiplier is read back. */
export interface PlayerSetFrozenParams {
  on?: boolean;
}
export interface PlayerSetFrozenResult {
  frozen: boolean;
  multiplier: number;
}

/** Start or end flight for a player, through the controller's own server call — the one a client sends when it takes off. Nothing reports flight back, so the result says what was asked for and marks itself unverified. */
export interface PlayerSetFlyingParams {
  on?: boolean;
}
export interface PlayerSetFlyingResult {
  flying: boolean;
  verified: boolean;
}

/** An online player's status points — the allocation the game computes their max HP, stamina, attack and carry weight from. Names are the game's own; the ones this build answers for are what comes back. */
export interface PlayerStatusPointsParams {
}
export interface PlayerStatusPointsResult {
  via: string;
  holder: string;
  points: unknown;
}

/** Spend status points on one of a player's stats, the way a level-up does. This is how a player's max HP goes up: it is computed from the points, not stored, so nothing else can raise it. Additive. stat is the game's own FName for the stat and is passed through verbatim — this build spends through the player controller and exposes no way to read the allocation back, so the result reports which readable stat moved instead. player.status_points lists the names to try. */
export interface PlayerStatusPointParams {
  stat: string;
  points?: number;
}
export interface PlayerStatusPointResult {
  stat: string;
  points: number;
  via: string;
  verified: boolean;
  stats: unknown;
}

/** Minutes a player has actually spent on this server, credited one minute at a time while they are online — a crash costs at most the minute in progress. Also reports the current session's minutes and whether they are online right now. Answers for offline players too: the total is history, not presence. */
export interface PlayerPlaytimeParams {
}
export interface PlayerPlaytimeResult {
  minutes: number;
  session: number;
  online: boolean;
  name: string;
}

/** Read a loaded pal's stats, targeting the id from pal.list or a pal.spawn result — including level, rank, talent* IVs and rank* soul upgrades. */
export interface PalStatsParams {
  pal: string;
}
export interface PalStatsResult {
  pal: string;
  species: string;
  stats: unknown;
}

/** Set any combination of a loaded pal's stats in one call; omitted fields are left alone. Values are absolute, on the same scale pal.stats reports — hp is converted to the rate the engine wants using the maximum it reports; asking for more HP than the maximum raises the maximum with it. Combat and work stats (level, rank, talent* IVs, rank* soul upgrades) are written to the save parameter and replicated — they are pal stats, and a player character is refused them rather than told they applied (player.status_point is the equivalent). Every write is read back: applied lists what changed, unverified what the engine accepted without visibly changing, failed what it refused. */
export interface PalSetStatsParams {
  pal: string;
  hp?: number;
  maxHp?: number;
  hunger?: number;
  shield?: number;
  maxShield?: number;
  level?: number;
  rank?: number;
  talentHp?: number;
  talentMelee?: number;
  talentShot?: number;
  talentDefense?: number;
  rankAttack?: number;
  rankDefence?: number;
  rankCraftSpeed?: number;
}
export interface PalSetStatsResult {
  pal: string;
  applied: string;
  unverified: string;
  failed: string;
  detail: string;
  stats: unknown;
}

/** Make a loaded pal hate a player, so it turns on them and fights. The hate system itself is not callable on this build, so the pal, its controller and its parameter component are searched for a hate function that is, and the engine's own damage path is the last resort. The result names the call that worked; a failure lists the hate-related functions this build does expose. sight=true additionally flips the pal's sensor temperament to attack-on-sight — it then goes for anyone who comes close, not only the caller. */
export interface PalAggroParams {
  pal: string;
  amount?: number;
  sight?: boolean;
}
export interface PalAggroResult {
  pal: string;
  amount: number;
  via: string;
}

/** Diagnostic dump for one loaded pal: its AI controller class, whether a player owns it, otomo flag, spawned type, and whether a hate system exists on it (which is not the same as it hating anyone). Run it on a wild pal and on a spawned one — the difference is why one fights back and the other does not. */
export interface PalInspectParams {
  pal: string;
}
export interface PalInspectResult {
  controller: string;
  hasController: boolean;
  owner: string;
  isOtomo: boolean;
  spawnedType: number;
  hateSystem: boolean;
}

/** Spawn a real wild pal: one of the world's own spawners near the player fires, so the game itself wires the newcomer — controller, wild group, combat permission. With a species, the spawner's lottery is rewritten for the shot and restored right after; aggressive=true also sets the newcomer's temperament to attack-on-sight. Without a species the spawner rolls its own table; kind=boss prefers an alpha spawner. Contrast pal.spawn, which places a hand-made pal at exact coordinates but outside the world's own wiring. */
export interface PalSpawnWildParams {
  species?: string;
  level?: number;
  aggressive?: boolean;
  kind?: string;
  radius?: number;
}
export interface PalSpawnWildResult {
  method: string;
  boss: boolean;
  distance: number;
  spawnersInRange: number;
}

/** Deprecated alias of pal.spawn_wild — same behavior, kept so existing scripts keep working. */
export interface PalForceSpawnParams {
  species?: string;
  level?: number;
  aggressive?: boolean;
  kind?: string;
  radius?: number;
}
export interface PalForceSpawnResult {
  method: string;
  boss: boolean;
  distance: number;
  spawnersInRange: number;
}

/** Which engine functions and properties this build actually exposes on an object, narrowed by substring. Reads the class chain through reflection and calls nothing, so it is safe to point anywhere. This is the answer to a not_supported: it names what does exist, fields included — a value the engine keeps in a property rather than behind a getter is invisible to a function list alone. on: player | state | controller | params | pal | palai | palparams | utility | manager | spawner, or class:<UClassName> for any live object by its class. */
export interface BridgeProbeParams {
  on?: string;
  pal?: string;
  filter?: string;
}
export interface BridgeProbeResult {
  on: string;
  class: string;
  count: number;
  functions: unknown;
  properties: unknown;
}

/** Every collection the agent and its mods have declared, with its owner, storage class and field shape — enough to render one this caller has never heard of. */
export interface DataCollectionsParams {
}
export interface DataCollectionsResult {
  collections: unknown;
}

/** Every record in one collection, by its qualified name (owner.name). */
export interface DataListParams {
  collection: string;
}
export interface DataListResult {
  collection: string;
  records: unknown;
  count: number;
}

/** One record from a collection. ok with record null when it is not there. */
export interface DataGetParams {
  collection: string;
  record: string;
}
export interface DataGetResult {
  record: unknown;
}

/** Write one record. Every parameter beyond collection and record becomes a field on it, so the call carries the shape the collection declared. List-valued fields cannot be set this way yet. */
export interface DataSetParams {
  collection: string;
  record: string;
}
export interface DataSetResult {
  collection: string;
  record: string;
}

/** Remove one record from a collection. */
export interface DataDeleteParams {
  collection: string;
  record: string;
}
export interface DataDeleteResult {
  removed: boolean;
}

/** Every capability, under the name the manifest gives it. */
export interface Capabilities {
  player: {
    /** Send a private system-chat message to one online player. */
    message(target: string, params: PlayerMessageParams): Promise<Envelope<PlayerMessageResult>>;
    /** Hand items to a player. The count is read before and after, so the result says whether they arrived: an unknown item id is reported as a failure rather than a success that added nothing. */
    give_item(target: string, params: PlayerGiveItemParams): Promise<Envelope<PlayerGiveItemResult>>;
    /** Move an online player. The destination is x/y/z coordinates, or another player: `to` names one and their position is the target — in chat, `!teleport to=@Name` is 'take me to them' and `!teleport @Name to=@me` is 'bring them here'. The result reports where they actually landed; a move that went nowhere is a failure, not a success. _(experimental)_ */
    teleport(target: string, params?: PlayerTeleportParams): Promise<Envelope<PlayerTeleportResult>>;
    /** Restore an online player to full: HP back to maximum and a full stomach, shield included where the build exposes it. Reports which of the three actually moved, and why any of them did not. _(experimental)_ */
    heal(target: string, params?: PlayerHealParams): Promise<Envelope<PlayerHealResult>>;
    /** How many of an item an online player carries. Money is the item id for gold. _(experimental)_ */
    count_item(target: string, params: PlayerCountItemParams): Promise<Envelope<PlayerCountItemResult>>;
    /** Whether an online player carries at least `count` of an item. _(experimental)_ */
    has_item(target: string, params: PlayerHasItemParams): Promise<Envelope<PlayerHasItemResult>>;
    /** Attach a key/value to a player, kept by the agent across restarts. The persistence primitive for 'already got the kit', ranks, notes. */
    set_tag(target: string, params: PlayerSetTagParams): Promise<Envelope<PlayerSetTagResult>>;
    set_tag(params: PlayerSetTagParams): Promise<Envelope<PlayerSetTagResult>>;
    set_tag(target: null, params: PlayerSetTagParams): Promise<Envelope<PlayerSetTagResult>>;
    /** Read one of a player's tags. ok with value null when the tag is unset. */
    get_tag(target: string, params: PlayerGetTagParams): Promise<Envelope<PlayerGetTagResult>>;
    get_tag(params: PlayerGetTagParams): Promise<Envelope<PlayerGetTagResult>>;
    get_tag(target: null, params: PlayerGetTagParams): Promise<Envelope<PlayerGetTagResult>>;
    /** Remove a tag from a player. */
    delete_tag(target: string, params: PlayerDeleteTagParams): Promise<Envelope<PlayerDeleteTagResult>>;
    delete_tag(params: PlayerDeleteTagParams): Promise<Envelope<PlayerDeleteTagResult>>;
    delete_tag(target: null, params: PlayerDeleteTagParams): Promise<Envelope<PlayerDeleteTagResult>>;
    /** The online player's exact world position (Engine Actor location, includes z). */
    position(target: string, params?: PlayerPositionParams): Promise<Envelope<PlayerPositionResult>>;
    /** Read an online player's stats — hp/maxHp, hunger/maxHunger, shield/maxShield, sanity, plus level, rank, talent* IVs and rank* soul upgrades from the save parameter. A stat this build does not expose comes back null rather than absent. _(experimental)_ */
    stats(target: string, params?: PlayerStatsParams): Promise<Envelope<PlayerStatsResult>>;
    /** Set any combination of an online player's stats in one call; omitted fields are left alone. Values are absolute, on the same scale player.stats reports — hp is converted to the rate the engine wants using the maximum it reports; asking for more HP than the maximum raises the maximum with it. Combat and work stats (level, rank, talent* IVs, rank* soul upgrades) are written to the save parameter and replicated — they are pal stats, and a player character is refused them rather than told they applied (player.status_point is the equivalent). Every write is read back: applied lists what changed, unverified what the engine accepted without visibly changing, failed what it refused. _(experimental)_ */
    set_stats(target: string, params?: PlayerSetStatsParams): Promise<Envelope<PlayerSetStatsResult>>;
    /** Make a player unkillable, or mortal again. Sets the engine's IsImmortality flag and zeroes the rate at which enemies inflict damage on them — the flag holds on this build but the damage path does not consult it, so the rate is what does the work. Both are read back. _(experimental)_ */
    set_immortal(target: string, params?: PlayerSetImmortalParams): Promise<Envelope<PlayerSetImmortalResult>>;
    /** Hold a player still, or let them go. Pins the engine's own walk-speed multiplier to zero under a Palladium-owned flag name, so releasing it restores whatever the game had rather than a guess at normal. The multiplier is read back. _(experimental)_ */
    set_frozen(target: string, params?: PlayerSetFrozenParams): Promise<Envelope<PlayerSetFrozenResult>>;
    /** Start or end flight for a player, through the controller's own server call — the one a client sends when it takes off. Nothing reports flight back, so the result says what was asked for and marks itself unverified. _(experimental)_ */
    set_flying(target: string, params?: PlayerSetFlyingParams): Promise<Envelope<PlayerSetFlyingResult>>;
    /** An online player's status points — the allocation the game computes their max HP, stamina, attack and carry weight from. Names are the game's own; the ones this build answers for are what comes back. _(experimental)_ */
    status_points(target: string, params?: PlayerStatusPointsParams): Promise<Envelope<PlayerStatusPointsResult>>;
    /** Spend status points on one of a player's stats, the way a level-up does. This is how a player's max HP goes up: it is computed from the points, not stored, so nothing else can raise it. Additive. stat is the game's own FName for the stat and is passed through verbatim — this build spends through the player controller and exposes no way to read the allocation back, so the result reports which readable stat moved instead. player.status_points lists the names to try. _(experimental)_ */
    status_point(target: string, params: PlayerStatusPointParams): Promise<Envelope<PlayerStatusPointResult>>;
    /** Minutes a player has actually spent on this server, credited one minute at a time while they are online — a crash costs at most the minute in progress. Also reports the current session's minutes and whether they are online right now. Answers for offline players too: the total is history, not presence. _(experimental)_ */
    playtime(target: string, params?: PlayerPlaytimeParams): Promise<Envelope<PlayerPlaytimeResult>>;
    playtime(params?: PlayerPlaytimeParams): Promise<Envelope<PlayerPlaytimeResult>>;
    playtime(target: null, params?: PlayerPlaytimeParams): Promise<Envelope<PlayerPlaytimeResult>>;
  };
  pal: {
    /** Spawn a pal, at explicit coordinates or beside a target player. One of the two is required; with coordinates the pal is placed there and the result reports where it landed. Level, rarity and passive-skill traits apply on spawn. hostile=true additionally turns the new pal on the target player through pal.aggro and reports whether that took. Spawns are not part of the world save: a server restart removes them. The result carries the new pal's id. _(experimental)_ */
    spawn(target: string, params: PalSpawnParams): Promise<Envelope<PalSpawnResult>>;
    spawn(params: PalSpawnParams): Promise<Envelope<PalSpawnResult>>;
    spawn(target: null, params: PalSpawnParams): Promise<Envelope<PalSpawnResult>>;
    /** Pals currently loaded in the world (players excluded), with species, level and — when the engine exposes it — a stable id usable as a pal.set_hp target. Capped at 100 rows; count reports the true total. _(experimental)_ */
    list(params?: PalListParams): Promise<Envelope<PalListResult>>;
    /** Read a loaded pal's stats, targeting the id from pal.list or a pal.spawn result — including level, rank, talent* IVs and rank* soul upgrades. _(experimental)_ */
    stats(params: PalStatsParams): Promise<Envelope<PalStatsResult>>;
    /** Set any combination of a loaded pal's stats in one call; omitted fields are left alone. Values are absolute, on the same scale pal.stats reports — hp is converted to the rate the engine wants using the maximum it reports; asking for more HP than the maximum raises the maximum with it. Combat and work stats (level, rank, talent* IVs, rank* soul upgrades) are written to the save parameter and replicated — they are pal stats, and a player character is refused them rather than told they applied (player.status_point is the equivalent). Every write is read back: applied lists what changed, unverified what the engine accepted without visibly changing, failed what it refused. _(experimental)_ */
    set_stats(params: PalSetStatsParams): Promise<Envelope<PalSetStatsResult>>;
    /** Make a loaded pal hate a player, so it turns on them and fights. The hate system itself is not callable on this build, so the pal, its controller and its parameter component are searched for a hate function that is, and the engine's own damage path is the last resort. The result names the call that worked; a failure lists the hate-related functions this build does expose. sight=true additionally flips the pal's sensor temperament to attack-on-sight — it then goes for anyone who comes close, not only the caller. _(experimental)_ */
    aggro(target: string, params: PalAggroParams): Promise<Envelope<PalAggroResult>>;
    /** Diagnostic dump for one loaded pal: its AI controller class, whether a player owns it, otomo flag, spawned type, and whether a hate system exists on it (which is not the same as it hating anyone). Run it on a wild pal and on a spawned one — the difference is why one fights back and the other does not. _(experimental)_ */
    inspect(params: PalInspectParams): Promise<Envelope<PalInspectResult>>;
    /** Spawn a real wild pal: one of the world's own spawners near the player fires, so the game itself wires the newcomer — controller, wild group, combat permission. With a species, the spawner's lottery is rewritten for the shot and restored right after; aggressive=true also sets the newcomer's temperament to attack-on-sight. Without a species the spawner rolls its own table; kind=boss prefers an alpha spawner. Contrast pal.spawn, which places a hand-made pal at exact coordinates but outside the world's own wiring. _(experimental)_ */
    spawn_wild(target: string, params?: PalSpawnWildParams): Promise<Envelope<PalSpawnWildResult>>;
    /** Deprecated alias of pal.spawn_wild — same behavior, kept so existing scripts keep working. _(experimental)_ */
    force_spawn(target: string, params?: PalForceSpawnParams): Promise<Envelope<PalForceSpawnResult>>;
  };
  server: {
    /** Tell everyone online something, as system chat. The agent sends it to each player itself, so a mod in the game can announce without anything outside it. */
    announce(params: ServerAnnounceParams): Promise<Envelope<ServerAnnounceResult>>;
  };
  permission: {
    /** A mod registers one permission node it owns, namespaced by its name, with a description and a default effect. Idempotent, and an operator's change to the default in permissions.config outranks it. */
    register(params: PermissionRegisterParams): Promise<Envelope<PermissionRegisterResult>>;
    /** May this player do this? Resolves user overrides, then groups by weight, then the default group, then the node's default; deny beats allow. Any parameter beyond `node` is taken as the call being asked about and matched against the winning entry's constraint — 'may spawn, but only Lamball' is one node plus a constraint. */
    check(target: string, params: PermissionCheckParams): Promise<Envelope<PermissionCheckResult>>;
    check(params: PermissionCheckParams): Promise<Envelope<PermissionCheckResult>>;
    check(target: null, params: PermissionCheckParams): Promise<Envelope<PermissionCheckResult>>;
    /** Set a per-player override: allow or deny a node for this player, optionally constrained ({"species":{"in":[…]}}, {"x":{"min":0,"max":1000}}). Player overrides beat every group. */
    grant(target: string, params: PermissionGrantParams): Promise<Envelope<PermissionGrantResult>>;
    grant(params: PermissionGrantParams): Promise<Envelope<PermissionGrantResult>>;
    grant(target: null, params: PermissionGrantParams): Promise<Envelope<PermissionGrantResult>>;
    /** Remove a per-player override, so groups decide again. */
    revoke(target: string, params: PermissionRevokeParams): Promise<Envelope<PermissionRevokeResult>>;
    revoke(params: PermissionRevokeParams): Promise<Envelope<PermissionRevokeResult>>;
    revoke(target: null, params: PermissionRevokeParams): Promise<Envelope<PermissionRevokeResult>>;
    /** Every registered node, grouped by the mod that registered it, with defaults. */
    nodes(params?: PermissionNodesParams): Promise<Envelope<PermissionNodesResult>>;
    /** A player's permission state: their groups, their overrides, and their role tag. */
    player(target: string, params?: PermissionPlayerParams): Promise<Envelope<PermissionPlayerResult>>;
    player(params?: PermissionPlayerParams): Promise<Envelope<PermissionPlayerResult>>;
    player(target: null, params?: PermissionPlayerParams): Promise<Envelope<PermissionPlayerResult>>;
  };
  group: {
    /** Create a permission group. tag is the [ROLE] shown in chat when enabled; weight orders groups when a player has several (highest wins). */
    create(params: GroupCreateParams): Promise<Envelope<GroupCreateResult>>;
    /** Change a group's tag or weight. */
    update(params: GroupUpdateParams): Promise<Envelope<GroupUpdateResult>>;
    /** Delete a group (the default group cannot be deleted). */
    delete(params: GroupDeleteParams): Promise<Envelope<GroupDeleteResult>>;
    /** Set one node entry on a group: allow or deny, optionally constrained. Wildcards work ('chatshop.*', '*'). */
    set_entry(params: GroupSetEntryParams): Promise<Envelope<GroupSetEntryResult>>;
    /** Remove a node entry from a group. */
    remove_entry(params: GroupRemoveEntryParams): Promise<Envelope<GroupRemoveEntryResult>>;
    /** Put a player into a group. */
    assign(target: string, params: GroupAssignParams): Promise<Envelope<GroupAssignResult>>;
    assign(params: GroupAssignParams): Promise<Envelope<GroupAssignResult>>;
    assign(target: null, params: GroupAssignParams): Promise<Envelope<GroupAssignResult>>;
    /** Take a player out of a group. */
    unassign(target: string, params: GroupUnassignParams): Promise<Envelope<GroupUnassignResult>>;
    unassign(params: GroupUnassignParams): Promise<Envelope<GroupUnassignResult>>;
    unassign(target: null, params: GroupUnassignParams): Promise<Envelope<GroupUnassignResult>>;
    /** All groups with their entries, weights, tags and member counts. */
    list(params?: GroupListParams): Promise<Envelope<GroupListResult>>;
  };
  location: {
    /** Save a named world location for the teleport picker. Stand somewhere, read player.position, save it — fast-travel points, arenas, meeting spots. */
    save(params: LocationSaveParams): Promise<Envelope<LocationSaveResult>>;
    /** Saved locations plus boss-spawn positions observed live (source: manual | boss). */
    list(params?: LocationListParams): Promise<Envelope<LocationListResult>>;
    /** Remove a saved location. */
    delete(params: LocationDeleteParams): Promise<Envelope<LocationDeleteResult>>;
  };
  bridge: {
    /** Which engine functions and properties this build actually exposes on an object, narrowed by substring. Reads the class chain through reflection and calls nothing, so it is safe to point anywhere. This is the answer to a not_supported: it names what does exist, fields included — a value the engine keeps in a property rather than behind a getter is invisible to a function list alone. on: player | state | controller | params | pal | palai | palparams | utility | manager | spawner, or class:<UClassName> for any live object by its class. _(experimental)_ */
    probe(target: string, params?: BridgeProbeParams): Promise<Envelope<BridgeProbeResult>>;
    probe(params?: BridgeProbeParams): Promise<Envelope<BridgeProbeResult>>;
    probe(target: null, params?: BridgeProbeParams): Promise<Envelope<BridgeProbeResult>>;
  };
  data: {
    /** Every collection the agent and its mods have declared, with its owner, storage class and field shape — enough to render one this caller has never heard of. _(experimental)_ */
    collections(params?: DataCollectionsParams): Promise<Envelope<DataCollectionsResult>>;
    /** Every record in one collection, by its qualified name (owner.name). _(experimental)_ */
    list(params: DataListParams): Promise<Envelope<DataListResult>>;
    /** One record from a collection. ok with record null when it is not there. _(experimental)_ */
    get(params: DataGetParams): Promise<Envelope<DataGetResult>>;
    /** Write one record. Every parameter beyond collection and record becomes a field on it, so the call carries the shape the collection declared. List-valued fields cannot be set this way yet. _(experimental)_ */
    set(params: DataSetParams): Promise<Envelope<DataSetResult>>;
    /** Remove one record from a collection. _(experimental)_ */
    delete(params: DataDeleteParams): Promise<Envelope<DataDeleteResult>>;
  };
}

/** The payload each event carries, by type. */
export interface EventData {
  "bridge.ready": {
    agent: string;
    version: string;
    envelope: number;
  };
  "bridge.hook": {
    hook: string;
    target: string;
    ok: boolean;
  };
  "player.chat": {
    message: string;
  };
  "player.join": {
    firstThisRun: boolean;
    firstEver: boolean;
    firstSeen: number;
    joins: number;
  };
  "player.respawn": {};
  "player.death": {
    killer: Subject;
  };
  "player.leave": {
    source: string;
  };
  "npc.spawn": {
    species: string;
    level: number;
    rare: boolean;
  };
  "player.hour": {
    hours: number;
    minutes: number;
  };
  "clock.minute": {
    date: string;
    weekday: string;
    hour: number;
    minute: number;
  };
  "clock.day": {
    date: string;
    weekday: string;
  };
  "player.item_use": {
    count: number;
    slot: string;
    target: string;
  };
}

export type EventType = keyof EventData;

/** An event as a handler receives it. */
export interface PalEvent<T extends EventType = EventType> {
  v: number;
  at: number;
  kind: 'event';
  type: T;
  subject: Subject;
  data: EventData[T];
}
