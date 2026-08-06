# Mod SDK

What a mod's script half is written against. The panel spawns
[`host.mjs`](host.mjs) per mod, which connects, waits for the game server,
imports the mod's entry file and drives it — so a mod file is logic and nothing
else.

## What a mod exports

```ts
export async function start(pal) { }                 // optional: runs once, after connecting
export const on = {                                  // optional: one key per event type
  'player.respawn': async (event, pal) => { },
};
```

`event` is the envelope from [docs/bridge.md](../../docs/bridge.md):
`{v, at, kind, type, subject, data}`. A handler that throws is logged against
the mod and the next event is still handled.

A file that exports neither has already done its work at import time — the host
says so and exits.

## The `pal` client

Handlers and `start` are passed it — a mod imports nothing. Everything on it is
`async`.

| Call | Answers |
|---|---|
| `pal.can(playerId, node)` | May this player? False when the check itself failed — an unanswered permission question is not a yes |
| `pal.give(playerId, item, count)` | True only once the inventory agrees. The engine accepts unknown item ids and silently adds nothing, so this reads the count back |
| `pal.count(playerId, item)` | How many they carry, or `null` when the build cannot answer |
| `pal.message(playerId, text)` | Private system-chat line |
| `pal.announce(text)` | Broadcast to everyone online |
| `pal.tag(playerId, key)` | A stored value, or `null`. Survives restarts — this is where "already claimed" lives |
| `pal.setTag` / `pal.deleteTag` | Write and remove one |
| `pal.players()` | Everyone the panel has ever seen |
| `pal.settings` | The `settings` object from the mod's `mod.json` |
| `pal.call(type, target, data)` | Any capability at all, raw envelope back |

`pal.call` is the escape hatch: every capability in
[docs/bridge-reference.md](../../docs/bridge-reference.md) is reachable through
it, including ones with no helper here. Game-level failure is `ok: false`
inside the returned envelope, not an exception.

## Settings

`mod.json` carries a free-form `settings` object, and the operator edits it
without touching code:

```json
{ "settings": { "items": [{ "item": "PalSphere", "count": 10 }] } }
```

```ts
for (const { item, count } of pal.settings.items) await pal.give(id, item, count);
```

## Running one by hand

The host is a plain program, so a mod can be run outside the panel against any
panel:

```bash
PALUP_TOKEN=palup_... PALUP_MOD_NAME=GoldStreak \
  PALUP_MOD_ENTRY=$PWD/mods/GoldStreak/main.ts \
  node packages/mod-sdk/host.mjs
```
