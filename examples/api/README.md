# External programs

Programs that talk to the server from *outside* it — a bot, a relay, a
dashboard — over the HTTP API in [docs/bridge.md](../../docs/bridge.md). They
authenticate with an API token and run wherever you like.

If what you want is a mod *for the server*, you want
[docs/mods.md](../../docs/mods.md) instead: a folder in `./mods`, no HTTP by
hand and no token to manage. [`WelcomeKit`](../lua/WelcomeKit) is one.

## Getting a token

1. Sign in to the panel and open **Admin → API tokens**.
2. Create one with **read + write** scope (read alone can follow events and run
   queries; write is needed for anything that changes the game).
3. Copy the value — it is shown once and stored only as a hash.

A token can only reach `/api/bridge/*`, so a leaked one cannot mint tokens or
restart the server. Revoke it from the same page.

## Running one

Node 22 or newer, no dependencies, nothing to install:

```bash
PALUP_TOKEN=palup_... node examples/api/death-feed.mjs
```

Set `PANEL_URL` if the panel is not on `http://localhost:3000`. Both scripts
share [`lib.mjs`](lib.mjs), about eighty lines of `fetch`.

| Script | What it demonstrates |
|---|---|
| [`death-feed.mjs`](death-feed.mjs) | The read-only half on its own: `death` events formatted into a feed with a running tally, optionally posted to Discord with `DISCORD_WEBHOOK`. Also shows handling a server restart mid-stream. |
| [`chat-shop.mjs`](chat-shop.mjs) | Adding `!kit`, `!heal`, `!gold` and `!deaths` as in-game commands from outside, each gated by a permission node the script registers on startup. The panel's own router only knows `!ping`; these need no mod change, no daemon change and no restart. |

Both follow the same shape: check `GET /api/bridge/schema`, follow the event
stream by cursor, and send everything through `POST /api/bridge/call`.
Rewriting either in another language means one auth header and JSON.

## Which door to use

| You want | Write | Needs |
|---|---|---|
| Server behaviour — rewards, rules, commands | a Palladium mod ([GoldStreak](../lua/GoldStreak)) | Palladium |
| The same, but reaching the network | a script mod ([packages/mod-sdk](../../packages/mod-sdk)) | Pal-Up |
| A program that lives elsewhere — Discord bot, dashboard, CLI | one of these | Pal-Up + a token |

The game process has no sockets, so anything that must call out lives on this
side of the line.
