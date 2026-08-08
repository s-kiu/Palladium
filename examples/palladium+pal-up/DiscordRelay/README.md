# DiscordRelay

Posts joins, deaths and chat into a Discord channel.

Needs **Palladium and Pal-Up**: it runs beside the game as a child process of
the panel, because it has to reach the network and UE4SS Lua has no sockets.
That is the only reason to leave the game process — anything that stays inside
it should be a [Palladium mod](../../palladium), which needs no panel and no
token.

## Install

Copy the folder into `./mods` and it starts within about ten seconds — no
restart, because the panel owns the process, not the game.

```bash
cp -r examples/palladium+pal-up/DiscordRelay mods/
```

It runs immediately with no webhook set, logging what it *would* have posted,
so you can watch it work before handing it a secret. The panel's **mods** page
shows that log.

## Autocompletion

Written inside a clone of this repository, `pal.` completes with the real
capabilities and their parameters: the root
[`jsconfig.json`](../../../jsconfig.json) maps `@pal-up/mod-sdk` to
[the types](../../../packages/mod-sdk), which are generated from the same
manifest as the runtimes. No `npm install` and no build step — VS Code,
VSCodium and anything else running the TypeScript language server pick it up.

The JSDoc lines in `mod.mjs` are what connect a handler to those types:

```js
/** @type {import('@pal-up/mod-sdk').ScriptMod['on']} */
export const on = { ... };
```

Working outside a clone, copy `packages/mod-sdk` next to your mod and point
`paths` at it, or drop the JSDoc and lose only the completions.

## Settings

In `mod.json`, under `settings` — the panel's mods page edits them, or open the
file:

| Setting | Default | Meaning |
|---|---|---|
| `webhook` | `""` | Your Discord webhook URL. Empty means log-only |
| `events` | `player.join`, `player.death` | Which events to relay. Add `player.chat` for chat |
| `username` | `Palworld` | The name posts appear under |

Make a webhook in Discord under **Server Settings → Integrations → Webhooks**.
Anyone with that URL can post to the channel, so treat it as a password: it
belongs in `mod.json` on your server, not in a screenshot or a repository.

## What it shows you

- **Events arrive already answered.** `player.join` carries `firstEver`, so a
  first-time greeting needs no list of who has been seen before — the agent's
  registry outlives the event file and every restart.
- **Failure is not a crash.** A rate limit or a refused post is logged and the
  next event carries on. A script mod that exits non-zero is restarted by the
  panel with a backoff, so crashing is a last resort, not error handling.
- **Chat is untrusted.** Player text is stripped of Discord's own markers and
  `@everyone` is defanged before it is posted. Anything a player typed is
  input, wherever it ends up.

## Turning it off

`touch mods/DiscordRelay/.disabled` — a script mod stops on the spot. Remove
the marker to start it again. The panel's mods page has a button for it.
