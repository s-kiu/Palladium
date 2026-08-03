# @pal-up/panel

Angular 19 web UI for pal-up: dashboard (status, versions, update flow),
players (kick/ban/unban, announce), mods (Lua/LogicMods/paks with toggles),
and backups (create, list, one-click rollback). Standalone components,
signals, no router — served as static files by the daemon.

```bash
npm run dev        # ng serve on :4200, /api proxied to the daemon on :3000
npm run build      # production bundle → dist/panel/browser
```
