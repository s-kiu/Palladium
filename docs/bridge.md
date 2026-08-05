# Bridge — in-game events and actions for external tools

Palworld's admin REST API can tell you who is online and broadcast to them, but
it cannot see what happens *inside* the game, and it cannot reach into it. The
bridge closes both gaps: a Lua mod running under UE4SS publishes in-game events
onto the shared data volume and executes actions handed back to it, and the
panel re-exposes both over HTTP.

The full list of events and actions — with parameters, stability and which
runtime serves them — is generated from one manifest and lives in
[bridge-reference.md](bridge-reference.md). This page is the protocol; runnable
examples live in [`examples/bridge/`](../examples/bridge).

## The envelope

Every message, in both directions, is one shape:

```json
{
  "v": 2,
  "at": 1785941621,
  "kind": "event",
  "type": "player.death",
  "subject": { "kind": "player", "id": "F8EAA197000000000000000000000000", "name": "Löyly" },
  "data": { "killer": { "kind": "player", "id": "1122…", "name": "Bo" } }
}
```

- `kind` is `event` or `result`; results add `id` (matching your call), `ok`,
  and `error` when `ok` is false.
- `subject` is the entity the message is about — always the same shape, always
  the same id. A player's `id` is their `PlayerUId` as 32 hex digits,
  byte-identical to the `playerId` in the game's own REST API. A subject can
  carry `position` when known.
- `data` is the per-type payload. Whatever the type, "who and where" never
  moves — a consumer that only reads `subject` need not know the type at all.
- Fields are only ever added within an envelope version, never removed or
  retyped. Match on `v`, ignore what you don't know.

## Authentication

Programs use **API tokens** — created on the panel's admin page, sent as one
header, revocable, scoped:

```
Authorization: Bearer palup_…
```

`read` tokens can follow events and run queries; `write` is needed for anything
that changes the game. Tokens can only reach `/api/bridge/*` — panel
administration stays with the browser session, so a leaked token cannot mint
tokens or restart the server. The cookie login also works on every bridge
endpoint (that is how the panel itself calls them).

## Reading events

```
GET /api/bridge/events?since=<byte-offset>&limit=<1..500>&type=player.chat,player.join
```

```json
{"events": [ … ], "cursor": 216}
```

`cursor` is a byte offset into the event file; pass it back as `since`. The
endpoint holds no per-client state, so cursors survive a panel restart. Rules:

- The event file is emptied when the game server boots. A cursor past the end
  rewinds to the start, and a response `cursor` *lower* than the one you sent is
  your signal to discard buffered state from the old run.
- Responses are capped at 256 KiB and `limit` events — keep calling until
  `cursor` stops advancing.
- `type` filters without affecting the cursor. Unparseable lines are skipped.

`player.join` events served over HTTP are enriched from the panel's database
with `firstEver`, `firstSeen` and `joins` — the file alone cannot know them,
because it starts empty every boot.

## Calling into the game

One verb, whatever the capability:

```
POST /api/bridge/call
{"type": "player.give_item", "target": "F8EAA197…", "data": {"item": "PalSphere", "count": 5}}
```

The answer is a result envelope. HTTP status is about the *protocol* (unknown
type, bad params, missing scope, timeout); `ok` inside the envelope is about
the *game* ("player not online"). A call that reaches the game and fails there
is HTTP 200 with `ok: false`.

Discovery is part of the API:

```
GET /api/bridge/schema
```

returns every capability with its parameters, stability, and — the part no
static list can give you — whether it is `live` right now: engine hooks move
between game builds, and the agent reports which ones actually registered.
Generic clients (the panel's own bridge page is one) render forms straight from
this.

## Storage

The panel keeps a SQLite database on the data volume (`.state/bridge.db`):
players ever seen, join/leave sessions, per-player tags, API tokens, and an
audit log of every call. That is what powers `firstEver`, the tags
capabilities, and `GET /api/bridge/players`. Nothing external ever touches the
database directly — it is served only through the capabilities.

Tags are the persistence primitive for scripts: `player.set_tag` /
`player.get_tag` / `player.delete_tag` survive restarts, so "already got the
starter kit" needs no database on the script's side.

## Permissions

Two layers, deliberately separate. Token scopes answer "may this *program* talk
to the API"; permission nodes answer "may this *player* do this". Nodes are
dotted strings with wildcards, resolved per player:

1. the player's own overrides (`permission.grant`) win outright,
2. then their groups, highest `weight` first,
3. then the default group everyone is in,
4. then the node's registered default — deny, if nobody registered it.

Within one source, an exact node beats `chatshop.*` beats `*`, and deny beats
allow on ties.

**Mods own their nodes.** A mod calls `permission.register` on startup —
idempotent, namespaced by its name, each node with a description and a default
— and its nodes appear on the panel's permissions page the moment it has run
once. `permission.check` is the one question everything asks; the panel's
groups and overrides UI is just a client for the same capabilities.

**Constraints make one node fine-grained.** An entry can carry per-parameter
matchers — `{"species": {"in": ["SheepBall"]}}`, `{"x": {"min": 0, "max":
1000}}` — so "may spawn, but only Lamball" or "may teleport, but only inside
the hub" is one grant, not a list. Enforcement is server-side: pass `as:
<playerId>` on any `/api/bridge/call` and the daemon resolves the capability
type as a node for that player, matches the call's own parameters against the
winning entry's constraints, and answers `ok: false, error:
"permission_denied…"` instead of executing. Built-in capabilities register
under the `bridge` mod with default deny, so acting on behalf of a player
always needs an explicit grant.

**Roles.** A group can carry a `tag` (`VIP`, `ADMIN`); a player's role is the
tag of their highest-weight tagged group. It rides on served events as
`subject.role`, and the panel's chat card shows `[ROLE]` before names when the
option is on. A second, experimental option prefixes the role into the in-game
chat itself: the agent edits the chat message parameter as the server receives
it, before the game broadcasts — the one engine write the agent performs, which
is why it is opt-in. The daemon feeds it via `.state/bridge-roles.tsv`; an
empty file disables the path entirely, and turning the option off takes effect
within a second.

## Positions and locations

`player.position` reads an online player's exact world coordinates from the
engine. `location.save` / `location.list` / `location.delete` keep a named
location book: stand somewhere worth returning to, read the position, save it
under a name, and the panel's teleport form offers it from a picker. Boss-
shaped spawns the world reports (`BOSS_*`, `RAID_*`, `GYM_*` species with a
position) are recorded automatically as `source: "boss"` — arenas announce
themselves; nobody types coordinates.

## Chat commands

The panel answers `!ping` itself (broadcasts `pong`, one command per player per
2 s). Everything beyond that belongs outside: read `player.chat`, call actions
— [`chat-shop.mjs`](../examples/bridge/chat-shop.mjs) adds `!kit`, `!heal`,
`!gold` and `!deaths` without touching mod, daemon or panel.

## The two doors that are not HTTP

- **The event file itself**: `/palworld/logs/bridge-events.jsonl` on the
  `palworld-data` volume, for sidecars that prefer tailing a file. Same
  envelope, minus the daemon's join enrichment. Two writers append to it — the
  agent, and the panel for `player.leave` (marked `source: "rest"`) — always
  whole lines.
- **The action queue**: `.state/bridge-actions.jsonl`, tab-separated
  `key=value` requests consumed by the agent. This is the daemon's private
  channel; write to it only if you are replacing the daemon.

## What the engine allows

Hook targets must be native (`/Script/…`) functions: Blueprint (`/Game/…`)
targets fault this UE4SS build rather than failing cleanly — registering one,
or even looking a UFunction path up with `StaticFindObject`, takes the server
down. The agent refuses them outright. Consequences: `player.leave` is derived
from the REST player list (a few seconds' delay), and Pal-capture events are
not available. Capabilities marked `experimental` in the reference use engine
calls that are plausible but not yet proven against a live player; the fastcrash
guard (three rapid crashes → unmodded boot) is the safety net while they are.

Everything outside the agent keys on the envelope and the manifest, not on
engine internals. If an event type stops appearing after a game patch,
`/api/bridge/schema` and `server/UE4SS.log` both say which hook died.
