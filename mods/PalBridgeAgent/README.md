# PalBridge Agent

A UE4SS Lua mod for **Palworld Linux dedicated servers**. It publishes in-game
events to a file and executes actions written back to another one, which gives
processes outside the game — bots, Discord relays, web panels, other mods'
tooling — a way in and out. UE4SS Lua has no sockets; files on disk are the only
transport available.

## Install

Drop the `PalBridgeAgent` folder into your server's UE4SS `Mods` directory (on
[pal-up](https://github.com/s-kiu/pal-up), into `./mods`) and restart the server.
`server/UE4SS.log` will show each hook registering.

Nothing else is required: the mod has no configuration and no dependencies
beyond UE4SS itself.

## What it writes

`/palworld/logs/bridge-events.jsonl` — one JSON object per line, appended:

```json
{"v":1,"at":1785900289,"type":"chat","player":"Ashen","userid":"F8EAA197000...","message":"hello"}
{"v":1,"at":1785900301,"type":"join","player":"Ashen","userid":"F8EAA197000...","initial":true}
{"v":1,"at":1785900420,"type":"death","player":"Ashen","userid":"F8EAA197000...","killer":"Bo"}
```

`userid` is `PlayerUId` as 32 hex digits, the same rendering the game's REST
API uses for `playerId`, so events can be joined to it directly.

Set `PAL_ROOT` to move both paths off `/palworld`.

The mod announces itself on load with a `ready` event and reports every hook it
registers as a `hook` event, so a consumer can tell what is live without
hardcoding a list.

## What it reads

`/palworld/.state/bridge-actions.jsonl` — tab-separated `key=value` lines, one
request per line. There is no JSON parser in the UE4SS Lua runtime, and a format
with no structure has nothing to exploit:

```
id=abc123	action=give_item	userid=1122AABB-...	item=PalSphere	count=5
id=abc124	action=message	userid=1122AABB-...	text=welcome back
```

Each request produces an `action` event carrying the same `id`, so the caller
can match a result to its request.

Both files are expected to be emptied when the server boots — offsets into them
are only meaningful within one run. On pal-up the entrypoint does this; on a
plain server, truncate them in your start script.

## Notes

- Native (`/Script/`) engine functions only. Blueprint targets crash this UE4SS
  build rather than failing cleanly, so the mod refuses them.
- Every hook and every action runs inside `pcall`; a failure is written to
  `UE4SS.log` and the event is dropped rather than reaching the game thread.
- Chat is untrusted input: strings are length-capped and JSON-escaped, and item
  ids are validated before they reach the inventory call.

Full contract, the HTTP API pal-up layers on top, and runnable examples:
[docs/bridge.md](https://github.com/s-kiu/pal-up/blob/main/docs/bridge.md).
