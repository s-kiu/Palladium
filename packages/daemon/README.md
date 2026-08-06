# @pal-up/daemon

Fastify (Node 24 + TypeScript) backend for the web panel. Serves the compiled
Angular UI and a JSON API under `/api`, authenticated by a session cookie for
the panel and by API tokens for everything else:

- **Auth** — login with `ADMIN_PASSWORD`, signed httpOnly session cookie
  (rolling 30-day lifetime, sign-out invalidates), rate-limited login. Bearer
  tokens are the programmatic credential and can only reach `/api/bridge/*`.
- **Live admin** — proxied to the game's REST API over the compose network:
  status, metrics, players, kick/ban/unban, announce, save-now.
- **The bridge** — reads the agent's event file by byte cursor and serves it at
  `/api/bridge/events`, writes actions to the queue the agent consumes, and
  answers `/api/bridge/schema` with what is live right now.
- **Mods** — lists all three kinds from the shared volume: Lua mods from
  `mods.txt`, Palladium mods from the registry snapshot the agent writes, and
  script mods from their `mod.json`. It *runs* the last kind, supervising each
  as a child process with a minted token, a log buffer and restart-on-failure.
- **Backups** — list/create directly on the volume; restore and game updates
  are scheduled via the server image's request-marker contract (no docker.sock
  anywhere).

Storage is split by who can reach it: `.state/bridge.db` (SQLite) holds what
only the panel produces — sessions, tokens, the audit log — while the player
registry, tags and permissions live in the agent's own store, because a mod
inside the game process cannot reach a database out here.

```bash
npm run dev        # tsx watch, expects /palworld + a running game container
npm run build      # tsc → dist/
```

Ships as one image together with the panel and the mod SDK:
`docker build -f packages/daemon/Dockerfile .` from the repo root.
