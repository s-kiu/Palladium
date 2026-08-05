# Bridge examples

Three things that were not possible before the bridge existed, each a plain
consumer of the HTTP API in [docs/bridge.md](../../docs/bridge.md). They share
one small client, [`lib.mjs`](lib.mjs), which is about eighty lines of `fetch`.

Node 18 or newer, no dependencies, nothing to install:

```bash
PALUP_TOKEN=palup_... node examples/bridge/welcome-kit.mjs
```

Create the token on the panel's admin page (read+write for these). Set
`PANEL_URL` if the panel is not on `http://localhost:3000`; `ADMIN_PASSWORD`
still works as a fallback credential.

| Script | What it demonstrates |
|---|---|
| [`welcome-kit.mjs`](welcome-kit.mjs) | Reacting to `join` with actions: first-time players get a private welcome and a starter kit, returning players just get a greeting. The join event arrives with `firstEver` already computed server-side, and the kit-claimed flag is a player tag, so neither a crash nor a second copy of the script hands out two kits. |
| [`death-feed.mjs`](death-feed.mjs) | The read-only half on its own: `death` events formatted into a feed with a running tally, optionally posted to Discord with `DISCORD_WEBHOOK`. Also shows handling a server restart mid-stream. |
| [`chat-shop.mjs`](chat-shop.mjs) | Adding `!kit`, `!heal`, `!gold` and `!deaths` as in-game commands from outside. The panel's own router only knows `!ping`; these need no mod change, no daemon change and no restart — which is the argument for the bridge in one file. |

All three follow the same shape: check `GET /api/bridge/schema`, follow the
event stream by cursor, and send everything through `POST /api/bridge/call`.
Rewriting any of them in another language means one auth header and JSON.
