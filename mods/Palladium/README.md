# Palladium

A modding framework for **Palworld dedicated servers**, as one UE4SS Lua
mod. It does two things:

- **Runs other mods.** Drop a folder with a `mod.lua` beside it and Palladium
  loads it, registers the permissions it declares, routes its chat commands and
  hands it every engine event. A mod is a table, not a process.
- **Bridges the game to the outside.** It publishes in-game events to a file
  and executes actions written back to another one, which gives bots, Discord
  relays and web panels a way in and out. UE4SS Lua has no sockets; files on
  disk are the only transport available.

Nothing outside the game is required for either. [Pal-Up](https://github.com/s-kiu/Palladium)
adds a web panel on top — permissions editing, item and pal pickers, history —
but a server that just wants mods needs this folder and nothing else.

## Writing a mod

`Mods/WelcomeKit/mod.lua`:

```lua
return {
    name = "WelcomeKit",
    permissions = {
        { node = "welcomekit.kit", description = "receive the starter kit on first join", default = "allow" },
    },
    settings = { items = { { item = "PalSphere", count = 10 } } },
    on = {
        ["player.join"] = function(event, pal)
            local who = event.subject.id
            if not event.data.firstEver or pal.tag(who, "claimed") then return end
            if not pal.can(who, "welcomekit.kit") then return end
            for _, entry in ipairs(pal.settings.items) do
                pal.player.give_item(who, { item = entry.item, count = entry.count })
            end
            pal.set_tag(who, "claimed", os.time())
            pal.player.message(who, "Welcome! Here is a starter kit to get you going.")
        end,
    },
    commands = {
        ["!kit"] = { node = "welcomekit.kit", run = function(event, args, pal)
            pal.player.message(event.subject.id, pal.tag(event.subject.id, "claimed")
                and "Delivered." or "Arrives on your first-ever join.")
        end },
    },
}
```

The manifest is a Lua table because there is no JSON parser in this runtime —
the call that loads the file is the call that reads the manifest.

`pal` carries every capability under the name the manifest gives it —
`pal.player.give_item`, `pal.pal.spawn_wild`, `pal.server.announce` — built
from the generated table at load time, so what chat calls `!give_item` and
HTTP calls `player.give_item` can never be something else here. Alongside them
sit the framework's own services, which are not capabilities: `pal.call` (any
capability by full name), `pal.can`, `pal.tag`/`set_tag`/`delete_tag`
(namespaced to your mod), `pal.data` (your declared collections),
`pal.settings` and `pal.log`.

Palladium loads the names in `Mods/Palladium/mods.list`, one per line, and
falls back to a directory listing when that file is absent. Each mod gets its
own environment, every handler runs under `pcall`, and events are delivered
from a queue rather than inside an engine hook — a mod that misbehaves is named
in the log and skipped, not a reason for the server to go down.

## What it remembers

Every mod keeps its own files in its own folder: `<Mod>/<mod>.config` for what
an operator edits, `<Mod>/<mod>.data` for its records. Palladium's own live
beside it — `Palladium/permissions.config` and `Palladium/bridge.data`. Both
formats are plain text: INI for config, tab-separated records for data, because
this runtime has no JSON parser and no database.

Settings ride the same folder. A mod may ship a commented
`settings.example.config` beside its code; on the first load with no live
`settings.config`, the example becomes it. From then on the operator's file
overrides the manifest defaults key by key, edits are picked up within seconds
without a restart, and updating the mod never touches it.

Permission nodes work the same way for mods too big to keep them in `mod.lua`:
a `permissions.config` beside the mod declares them, one `[node]` section each
with `default` and `description`, seeded from a shipped
`permissions.example.config` on first load. When that file is present it is the
whole truth — the `permissions` table in `mod.lua` is not read — so an operator
has one place to look. Nodes register as a mod loads, so edits apply on the
next restart.

Permissions are one file rather than one per mod: a group spans every mod, so
splitting membership across them would leave no answer for which copy wins.

On Pal-Up the loader reads an rsync copy of the mod folders, so writes go to the
originals instead — `PALLADIUM_MODS_SOURCE` names them, rather than the
framework guessing and risking a write the next boot undoes.
There is no database and no JSON parser in this runtime, so records are
appended and the file is rewritten when the dead weight outgrows the live
records; a line torn by a crash is dropped and the file healed on the next
load.

That is what makes `pal.can` and `pal.tag` work on a server running nothing but
this mod: permissions resolve as overrides, then groups by weight, then the
default group, then the node's registered default.

Full guide: [docs/mods.md](https://github.com/s-kiu/Palladium/blob/main/docs/mods.md).

## Install

Drop the `Palladium` folder into your server's UE4SS `Mods` directory (on
[Pal-Up](https://github.com/s-kiu/Palladium), into `./mods`) and restart the server.
`server/UE4SS.log` will show each hook registering.

Nothing else is required: the mod has no configuration and no dependencies
beyond UE4SS itself.

To install a mod *for* it, drop that folder in beside this one and name it in
`Mods/Palladium/mods.list`, one per line:

```
; mods Palladium loads, in order
GoldStreak
```

On Pal-Up that file is regenerated on every boot from `./mods` and you never
touch it. Standalone, it is how you control load order and disable a mod
without deleting it — the same job `load_order.txt` does for BPModLoaderMod. If
the file is absent entirely, Palladium falls back to asking the loader for a
directory listing.

## What it writes

`<root>/logs/bridge-events.jsonl` — one JSON object per line, appended:

```json
{"v":2,"at":1785942430,"kind":"event","type":"player.chat","subject":{"kind":"player","id":"F8EAA197000...","name":"Ashen"},"data":{"message":"hello"}}
{"v":2,"at":1785942431,"kind":"event","type":"player.join","subject":{"kind":"player","id":"F8EAA197000...","name":"Ashen"},"data":{"firstThisRun":true,"firstEver":false,"firstSeen":1785941621,"joins":7}}
```

Envelope v2: every line is `{v, at, kind, type, subject, data}`; action results
add `id`, `ok`, `error`. The subject id is `PlayerUId` as 32 hex digits, the
same rendering the game's REST API uses for `playerId`, so events join to it
directly. Which events exist — and which engine hooks produce them — comes from
`Scripts/generated/capabilities.lua`, generated from the capability manifest in
the Pal-Up repo; this mod implements handlers for what that table declares.

Where these live is decided at boot, in this order: `PAL_ROOT` if you set it,
then `/palworld` if it exists (that is where Pal-Up mounts its volume), and
otherwise a `palladium/` folder beside the game binaries. So a standalone
server needs no configuration — and if the chosen directory turns out not to be
writable, the mod says so in the log at boot and keeps saying so, because a
store that cannot persist looks perfectly healthy until the next restart.

The mod announces itself on load with a `ready` event and reports every hook it
registers as a `hook` event, so a consumer can tell what is live without
hardcoding a list.

Write-scope actions also land in `<root>/logs/bridge-audit.log` — one line per
call with who asked and from where (chat or a mod; Pal-Up's daemon writes the
same trail for HTTP), so an operator can answer "who spawned that" later.

`player.leave` has no hook behind it — nothing native fires on disconnect, and
a Blueprint target faults this build. The agent watches who is still in the
world instead and reports a leave once someone has been missing from two
consecutive scans, so it arrives within a few seconds rather than instantly.

## What it reads

`<root>/.state/bridge-actions.jsonl` — tab-separated `key=value` lines, one
request per line. There is no JSON parser in the UE4SS Lua runtime, and a format
with no structure has nothing to exploit:

```
id=abc123	action=player.give_item	userid=F8EAA197000...	item=PalSphere	count=5
id=abc124	action=player.message	userid=F8EAA197000...	text=welcome back
```

Each request produces an `action` event carrying the same `id`, so the caller
can match a result to its request.

Both files are expected to be emptied when the server boots — offsets into them
are only meaningful within one run. On Pal-Up the entrypoint does this; on a
plain server, truncate them in your start script.

## Notes

- Native (`/Script/`) engine functions only. Blueprint targets crash this UE4SS
  build rather than failing cleanly, so the mod refuses them.
- Every hook and every action runs inside `pcall`; a failure is written to
  `UE4SS.log` and the event is dropped rather than reaching the game thread.
- Chat is untrusted input: strings are length-capped and JSON-escaped, and item
  ids are validated before they reach the inventory call.

Full contract, the HTTP API Pal-Up layers on top, and runnable examples:
[docs/bridge.md](https://github.com/s-kiu/Palladium/blob/main/docs/bridge.md).
