# Bridge — in-game events and actions for external tools

Palworld's admin REST API can tell you who is online and broadcast to them, but
it cannot see what happens *inside* the game, and it cannot reach into it. The
bridge closes both gaps: a Lua mod running under UE4SS publishes in-game events
onto the shared data volume and executes actions handed back to it, and the
panel re-exposes both over HTTP.

Two integration surfaces, pick whichever fits your tool:

| Surface | Where | Good for |
|---|---|---|
| Event file | `/palworld/logs/bridge-events.jsonl` on the `palworld-data` volume | sidecar containers, anything that can tail a file |
| Panel API | port 3000, `/api/bridge/*` | anything that speaks HTTP |

Runnable examples of all of it live in [`examples/bridge/`](../examples/bridge).

## Events

`PalBridgeAgent` (in `./mods/`, a normal Lua mod — disable it with
`touch mods/PalBridgeAgent/.disabled`) appends one JSON object per line:

```json
{"v":1,"at":1785900289,"type":"chat","player":"Ashen","userid":"1122AABB-...","message":"hello"}
```

Every line carries `v`, `at` and `type`; the rest depends on the type.

| Field | Meaning |
|---|---|
| `v` | Schema version. Fields are only ever added, never removed or retyped, so match on `v` and ignore what you don't know. |
| `at` | Unix epoch seconds, server clock. |
| `type` | Event kind, see below. |

| Type | Extra fields | When |
|---|---|---|
| `ready` | `agent`, `version`, `schema`, `actions` | The agent loaded. Its absence is what "no bridge" means. |
| `hook` | `hook`, `target`, `ok`, `state` | One per engine hook, reporting whether it registered. |
| `chat` | `player`, `userid`, `message` | A player sent a chat message. |
| `join` | `player`, `userid`, `initial` | A player's character finished initialising. `initial` is false when they already joined earlier in this same server run. |
| `death` | `player`, `userid`, and `killer`/`killerUserid` when another player did it | A player died. Pals dying are not reported. |
| `leave` | `player`, `userid`, `source` | A player disconnected. |
| `action` | `id`, `action`, `userid`, `ok`, `detail` | The outcome of a request you sent. |

`player` is `Unknown` and `userid` is `""` when the game did not supply them.
`message` is capped at 512 characters.

The file is emptied when the server boots, exactly like `logs/server.log`. It is
append-only within a run. Chat text is player input: treat it as untrusted, and
expect control characters to arrive JSON-escaped (`\n`, `\u0007`).

Two processes append to it: the agent, and the panel for `leave` events (which
carry `source: "rest"` — see *What the engine allows* below). Both write whole
lines, so a reader tailing it never sees a torn record.

## The panel API

Authenticated like every other panel endpoint (sign in at `/api/login`, the
session cookie carries from there).

### Reading events

```
GET /api/bridge/events?since=<byte-offset>&limit=<1..500>&type=chat,join
```

```json
{"events": [ ... ], "cursor": 216}
```

`cursor` is a byte offset into the event file. Pass it back as `since` to get
only what arrived after your last call — the endpoint holds no per-client state,
so cursors survive a panel restart. Two rules to implement:

- A cursor past the end of the file means the server rebooted and the file was
  emptied. The endpoint rewinds to the start and returns the new run from its
  beginning; a cursor in the response *lower* than the one you sent is your
  signal to discard what you had.
- Responses are capped at 256 KiB and at `limit` events, so keep calling until
  `cursor` stops advancing.

`type` filters the returned events without affecting the cursor, so a narrow
reader still advances past everything it skipped. Unparseable lines are skipped
rather than returned — one bad line cannot stall the stream.

### What is running

```
GET /api/bridge/status
```

Reports the agent's name and version, which actions it accepts, every hook it
registered with its live/failed state, and the event types seen so far. This is
what the panel's **bridge** page is built from, so a hook added to the mod shows
up in the UI with no panel change.

### Who has been here

```
GET /api/bridge/players
```

Every user id the bridge has ever seen, with `name`, `firstSeen`, `lastSeen`,
`joins` and `online`. Kept across restarts — the event file starts empty every
boot, so this is the only place a first-seen date lives.

### Sending actions

```
POST /api/bridge/actions   {"action": "give_item", "userid": "...", "item": "PalSphere", "count": 5}
```

The request is queued for the agent, which executes it on the game thread and
reports back; the call returns when the outcome is known, or 504 after 6
seconds. Consult `status.actions` rather than hardcoding the list.

| Action | Parameters | Notes |
|---|---|---|
| `give_item` | `userid`, `item`, `count` | Item ids are the game's internal names. The player must be online. |
| `message` | `userid`, `text` | Private message to one player. |

```json
{"id": "501ce780...", "ok": false, "detail": "player not online", "event": { ... }}
```

Every execution is also recorded in the server log with a `[panel]` prefix.

## Chat commands

The panel watches the stream and answers commands typed in game. A message
starting with `!` is matched against its table; anything unrecognised is ignored
and passes through as an ordinary chat event.

| Command | Effect |
|---|---|
| `!ping` | Broadcasts `pong` to everyone online. |

Each player may trigger one built-in command every 2 seconds. Adding more
commands does not require touching the panel — read the stream and call the
actions API, which is what [`examples/bridge/chat-shop.mjs`](../examples/bridge/chat-shop.mjs)
does.

## What the engine allows

The agent hooks three native engine functions, verified against Palworld
`v1.0.2.101103` (Steam build 24466863):

| Event | Hooked function |
|---|---|
| `chat` | `/Script/Pal.PalPlayerController:EnterChat_Receive` |
| `join` | `/Script/Pal.PalPlayerCharacter:OnCompleteInitializeParameter` |
| `death` | `/Script/Pal.PalCharacter:OnDeadCharacter` |

Blueprint functions — anything under `/Game/` — cannot be hooked on this UE4SS
build, and attempting it is not merely ineffective: registering against a
Blueprint class before the game has loaded it faults the process, and so does
looking a UFunction path up with `StaticFindObject`. The agent therefore refuses
non-native targets outright. That rules out the Blueprint route to disconnect
and Pal-capture events; `leave` instead comes from the panel watching the game's
own player list, which is why it carries `source: "rest"` and arrives within a
few seconds rather than instantly. Pal captures are not available.

Engine function names move between game builds. If an event type stops
appearing after a patch, `GET /api/bridge/status` and `server/UE4SS.log` both
report which hooks registered. Failures inside the agent are logged there and
the event is dropped; the game is never taken down by them.

Everything outside the agent keys on the schema above, not on engine internals.
