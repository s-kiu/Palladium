# Bridge examples

Three things that were not possible before the bridge existed, each a plain
consumer of the HTTP API in [docs/bridge.md](../../docs/bridge.md). They share
one small client, [`lib.mjs`](lib.mjs), which is about eighty lines of `fetch`.

Node 18 or newer, no dependencies, nothing to install:

```bash
ADMIN_PASSWORD=your-panel-password node examples/bridge/welcome-kit.mjs
```

Set `PANEL_URL` if the panel is not on `http://localhost:3000`.

| Script | What it demonstrates |
|---|---|
| [`welcome-kit.mjs`](welcome-kit.mjs) | Reacting to `join` with actions: first-time players get a private welcome and a starter kit, returning players just get a greeting. Uses the player registry to tell them apart, which the event stream alone cannot do — it starts empty every boot. |
| [`death-feed.mjs`](death-feed.mjs) | The read-only half on its own: `death` events formatted into a feed with a running tally, optionally posted to Discord with `DISCORD_WEBHOOK`. Also shows handling a server restart mid-stream. |
| [`chat-shop.mjs`](chat-shop.mjs) | Adding `!kit`, `!heal` and `!deaths` as in-game commands from outside. The panel's own router only knows `!ping`; these need no mod change, no daemon change and no restart — which is the argument for the bridge in one file. |

All three follow the same shape: log in, check `GET /api/bridge/status`, then
follow the event stream by cursor and call `POST /api/bridge/actions`. Rewriting
any of them in another language means holding a session cookie and parsing JSON.
