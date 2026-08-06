# @pal-up/panel

Angular 19 web UI for pal-up. Standalone components, signals, no router —
served as static files by the daemon.

- **Dashboard** — status, versions, resources, the update flow.
- **Players** — kick/ban/unban, announce.
- **Mods** — all four kinds in one place: Palladium mods with what they handle,
  own and answer to; script mods with their live state, enable/disable and log
  tail; Lua mods with `mods.txt` toggles; LogicMods and loose paks.
- **Palladium** — every capability rendered as a form from the schema, with
  pickers for items, pal species, traits, saved locations and known players,
  plus a filterable live event stream.
- **Permissions** — nodes, groups, weights, roles and per-player overrides.
- **Chat, console, settings, backups** — the in-game chat feed, the vanilla
  REST command surface, a grouped settings editor with diff-before-apply, and
  one-click backup create/rollback.

```bash
npm run dev        # ng serve on :4200, /api proxied to the daemon on :3000
npm run build      # production bundle → dist/panel/browser
```
