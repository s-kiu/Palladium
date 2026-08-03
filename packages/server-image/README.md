# server-image — the pal-up Palworld server container

Palworld dedicated server for Linux x86_64 with the native-Linux **UE4SS** mod
loader baked in.

What the entrypoint does on every boot, in order:

1. **Install / update** the server via SteamCMD, honoring `UPDATE_ON_BOOT`
   (`true` / `false` / `hold`) — with an automatic world backup before any
   update is applied.
2. **Link saves** — `Pal/Saved` is a symlink into `/palworld/saves`, so world
   data survives reinstalls and is what backups snapshot.
3. **Install UE4SS** (if vendored into the image) — `libUE4SS.so` +
   Palworld-specific configs, headless settings enforced, bundled mods synced.
4. **Sync mods** from the user folders and **regenerate `mods.txt`**.
5. **Generate `PalWorldSettings.ini`** from environment variables, then copy
   any hand-managed files from `config/persist/` over the tree.
6. **Start the server** (`LD_PRELOAD` injection when UE4SS is active) and
   supervise it: graceful REST-based save+shutdown on `docker stop`, backup on
   shutdown, optional interval backups.

## Volume layout (`/palworld`)

```
/palworld/
├── server/        # the Steam install (disposable, ~15 GB)
├── saves/         # world + generated config — THE precious data
├── mods/          # ← you: UE4SS Lua mods (one folder per mod)
├── paks/          # ← you: loose .pak mods            → Pal/Content/Paks/~mods
├── logicmods/     # ← you: Blueprint/LogicMods .pak   → Pal/Content/Paks/LogicMods
├── config/
│   ├── persist/   # ← you: files copied verbatim over server/ on every boot
│   └── panel-settings.env  # written by the web panel; highest-precedence settings
├── backups/       # palworld-<utc-timestamp>-<tag>.tar.gz
├── logs/          # server.log — game output + entrypoint log, size-capped
└── .state/        # markers: build ids, mod manifest, update-held, …
```

`.state/` also carries the **request-marker contract** used by the web panel:
writing `update-request` or `restore-request` (containing a backup archive
name) and then stopping the game makes the entrypoint execute that action on
its next start, before the game launches — the only safe moment for both.
Results land in `.state/last-request-result`. A `stop-request` marker parks
the container instead of launching the game (an admin "stop" that survives
the restart policy); deleting it starts the server again. Pending update or
restore requests still execute while parked.

`config/persist/` is the escape hatch for any file the game or a mod keeps
resetting (`PalModSettings.ini` is the classic case): place the file at its
server-relative path — e.g. `config/persist/Pal/Binaries/Linux/PalModSettings.ini`
— and it is restored on every boot, after config generation (persist wins).

## Commands

Everything is exposed through one dispatcher (`pal-up`) inside the container:

```bash
docker compose exec palworld pal-up check-update
docker compose exec palworld pal-up backup [tag]
docker compose exec palworld pal-up backups
docker compose exec palworld pal-up palapi players
docker compose exec palworld pal-up palapi announce "restart in 5 min"

# these need the server stopped:
docker compose run --rm palworld update [--validate]
docker compose run --rm palworld restore <archive|latest>
```

## Environment reference

| Variable | Default | Meaning |
|---|---|---|
| `ADMIN_PASSWORD` | — | **Required.** In-game admin + REST API credential |
| `SERVER_NAME` | `Palworld Server (pal-up)` | Server browser name |
| `SERVER_DESCRIPTION` | empty | Server browser description |
| `SERVER_PASSWORD` | empty | Join password (empty = open) |
| `MAX_PLAYERS` | `32` | `ServerPlayerMaxNum` |
| `GAME_PORT` | `8211` | UDP game port (launch arg) |
| `PUBLIC_IP` / `PUBLIC_PORT` | auto / `GAME_PORT` | For NAT setups |
| `REST_API_ENABLED` / `REST_API_PORT` | `true` / `8212` | Admin REST API (keep internal!) |
| `RCON_ENABLED` / `RCON_PORT` | `false` / `25575` | Legacy RCON |
| `UPDATE_ON_BOOT` | `true` | `true` \| `false` \| `hold` |
| `VALIDATE_ON_BOOT` | `false` | Force Steam file validation |
| `MODS_ENABLED` | `true` | Master switch for UE4SS injection |
| `MODS_TXT_MODE` | `managed` | `managed` regenerates mods.txt each boot; `manual` leaves it |
| `MODS_AUTO_FALLBACK` | `true` | After `FASTCRASH_LIMIT` rapid crashes with UE4SS active, restart unmodded so the server stays up |
| `FASTCRASH_LIMIT` / `FASTCRASH_WINDOW_SECONDS` | `3` / `120` | What counts as a rapid-crash streak |
| `UE4SS_FORCE_SYNC` | `false` | Re-copy UE4SS files even if unchanged |
| `SETTINGS_MODE` | `env` | `env` generates PalWorldSettings.ini; `manual` leaves it |
| `BACKUP_ON_STOP` | `true` | Snapshot after every shutdown/crash |
| `BACKUP_BEFORE_UPDATE` | `true` | Snapshot before applying a game update |
| `BACKUP_INTERVAL_MINUTES` | `0` | `0` = off; e.g. `240` = every 4 h |
| `UPDATE_CHECK_INTERVAL_MINUTES` | `60` | Background Steam build check (feeds the panel; `0` = off) |
| `BACKUP_KEEP_COUNT` | `14` | Prune to newest N (`0` = unlimited) |
| `BACKUP_KEEP_DAYS` | `0` | Also delete older than N days (`0` = off) |
| `BACKUP_HOT` | `true` | Ask the live server to save before snapshotting |
| `SHUTDOWN_WARN_SECONDS` | `30` | Player warning before graceful stop |
| `SHUTDOWN_MESSAGE` | `Server is shutting down` | Broadcast text |
| `PUID` / `PGID` | `1000` | Owner of `/palworld` (match your host user) |
| `SKIP_CHOWN` | `false` | Skip ownership fixing on boot |
| `SERVER_TICKRATE` | unset | Engine tick-rate cap (default 60); e.g. `120` — smoother, but much higher CPU |
| `SERVER_ARGS` | empty | Extra `PalServer.sh` flags |
| `PERF_ARGS` | community defaults | `-useperfthreads -NoAsyncLoadingThread -UseMultithreadForDS` |
| `STEAM_APP_ID` | `2394010` | Palworld Dedicated Server |
| `OPT_<IniKey>` | — | Any `OptionSettings` key verbatim, e.g. `OPT_SupplyDropSpan=180` |

Gameplay settings (`EXP_RATE`, `PVP`, `DIFFICULTY`, …) are listed in
[`config/settings.map`](config/settings.map); anything missing there is always
reachable via `OPT_<IniKey>`.

## UE4SS vendoring

The mod loader is **checksum-pinned and baked in at build time** — never
fetched at container runtime. The pin lives in
[`ue4ss/ue4ss.lock`](ue4ss/ue4ss.lock): repository, release tag, artifact name
(release assets embed the tag, so the lock stores a `{tag}` template), and the
artifact's sha256. During `docker build`, the pinned artifact is taken from
`ue4ss/vendor/` if present, otherwise downloaded from the pinned release —
and rejected either way unless its sha256 matches the lock.

```bash
./ue4ss/vendor.sh                # optional: pre-fetch + verify for offline builds
./ue4ss/vendor.sh --verify       # verify an already-downloaded artifact
./ue4ss/vendor.sh --pin <tag>    # move to a new release and record its checksum
```

You are trusting a native library that gets `LD_PRELOAD`ed into the game
server — review upstream releases before re-pinning (or build from source and
drop your own tarball into `ue4ss/vendor/` first), and test every pin bump on
a copy of your world. Without a pinned checksum the image builds in
**unmodded** mode and says so at startup.

Build args: `UE4SS_OMIT=true` forces an unmodded image even with a valid pin.

## Tests

```bash
./test/run-tests.sh    # shellcheck + bats (falls back to docker images)
```

CI runs shellcheck, the bats suite, an image build, and an entrypoint smoke
test on every push.
