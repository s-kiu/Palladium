# Bridge — in-game events for external tools

Palworld's admin REST API can tell you who is online and broadcast to them, but
it cannot see what happens *inside* the game. The bridge closes that gap: a Lua
mod running under UE4SS publishes in-game events onto the shared data volume,
and the panel re-exposes them over HTTP.

Two integration surfaces, pick whichever fits your tool:

| Surface | Where | Good for |
|---|---|---|
| Event file | `/palworld/logs/bridge-events.jsonl` on the `palworld-data` volume | sidecar containers, anything that can tail a file |
| Panel API | `GET /api/bridge/events` on port 3000 | anything that speaks HTTP |

## The event file

`PalBridgeAgent` (in `./mods/`, a normal Lua mod — disable it with
`touch mods/PalBridgeAgent/.disabled`) appends one JSON object per line:

```json
{"v":1,"at":1785900289,"type":"chat","player":"Ashen","userid":"1122AABB-...","message":"hello"}
```

| Field | Meaning |
|---|---|
| `v` | Schema version. Fields are only ever added, never removed or retyped, so match on `v` and ignore what you don't know. |
| `at` | Unix epoch seconds, server clock. |
| `type` | Event kind. `chat` is what the agent publishes. |
| `player` | Display name, or `Unknown` when the game did not supply one. |
| `userid` | Player UID in the dashed form the REST API uses, or `""` when unknown. |
| `message` | Chat text, capped at 512 characters. |

The file is emptied when the server boots, exactly like `logs/server.log`. It
is append-only within a run and has a single writer, so a reader can tail it
without locking. Chat text is player input: treat it as untrusted, and expect
control characters to arrive JSON-escaped (`\n`, `\u0007`).

## The panel API

```
GET /api/bridge/events?since=<byte-offset>&limit=<1..500>
```

Authenticated like every other panel endpoint (sign in at `/api/login`, the
session cookie carries from there). Response:

```json
{"events": [ ... ], "cursor": 216}
```

`cursor` is a byte offset into the event file. Pass it back as `since` to get
only what arrived after your last call — the endpoint holds no per-client
state, so cursors survive a panel restart. Two rules to implement:

- A cursor past the end of the file means the server rebooted and the file was
  emptied. The endpoint rewinds to the start and returns the new run from its
  beginning; a cursor in the response lower than the one you sent is your
  signal to discard what you had.
- Responses are capped at 256 KiB and at `limit` events, so keep calling until
  `cursor` stops advancing.

Unparseable lines are skipped rather than returned, and the cursor moves past
them — one bad line cannot stall the stream.

## Chat commands

The panel watches the stream and answers commands typed in game. A message
starting with `!` is matched against the command table; anything unrecognised
is ignored and passes through as an ordinary chat event.

| Command | Effect |
|---|---|
| `!ping` | Broadcasts `pong` to everyone online. |

Each player may trigger one command every 2 seconds. Every execution is
recorded in the server log with a `[panel]` prefix, next to the other admin
actions, and the chat itself is visible on the panel's **admin** page.

## Compatibility

The agent hooks one engine function,
`/Script/Pal.PalPlayerController:EnterChat_Receive`, verified against Palworld
`v1.0.2.101103` (Steam build 24466863). Engine function names move between game
builds; if chat events stop appearing after a patch, that hook is the thing to
check — `server/UE4SS.log` records whether it registered. Failures inside the
agent are logged there and the event is dropped; the game is never taken down
by them.

Everything outside the agent keys on the schema above, not on engine internals.
