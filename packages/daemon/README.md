# @pal-up/daemon

Fastify (Node 22 + TypeScript) backend for the web panel. Serves the compiled
Angular UI and a cookie-authenticated JSON API under `/api`:

- **Auth** — login with `ADMIN_PASSWORD`, signed httpOnly session cookie
  (rolling 30-day lifetime, sign-out invalidates), rate-limited login.
- **Live admin** — proxied to the game's REST API over the compose network:
  status, metrics, players, kick/ban/unban, announce, save-now.
- **Mods** — reads `mods.txt` and the drop-in folders from the shared volume;
  toggles user mods via the `.disabled` marker convention.
- **Backups** — list/create directly on the volume; restore and game updates
  are scheduled via the server image's request-marker contract (no docker.sock
  anywhere).

```bash
npm run dev        # tsx watch, expects /palworld + a running game container
npm run build      # tsc → dist/
```

Ships as one image together with the panel:
`docker build -f packages/daemon/Dockerfile .` from the repo root.
