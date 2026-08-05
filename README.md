# pal-up

**A modded Palworld dedicated server for Linux, in one `docker compose up`.**

Palworld's official mod system supports **Windows** dedicated servers only. pal-up brings server-side modding to Linux by integrating the native [UE4SS Linux port](https://github.com/BlackBookOfficial/ue4ss-linux-palworld) into a batteries-included container — mod loading, folder routing, config generation, safe updates, and backups, all driven by three drop-in folders and one `.env` file.

> [!NOTE]
> Mod loading currently ships via the community-maintained
> [UE4SS build v1.0.3-palworld-linux](https://github.com/Qiiks/ue4ss-linux-palworld/releases/tag/v1.0.3-palworld-linux),
> which carries the Linux stability fixes for the current Palworld build while
> they are merged upstream ([details](https://github.com/BlackBookOfficial/ue4ss-linux-palworld/issues/11)).
> The pin lives in [ue4ss.lock](packages/server-image/ue4ss/ue4ss.lock) and
> will move back to an upstream release once one includes the fixes.

## Features

- **Modded out of the box** — the UE4SS mod loader (native Linux build, checksum-pinned, baked into the image) is injected via `LD_PRELOAD` with headless settings applied automatically.
- **Drop-in mod folders** — `./mods` (Lua), `./paks` (loose `.pak`), `./logicmods` (Blueprint mods) are synced into the correct game paths on every start and `mods.txt` is regenerated to match. Disable any mod with a `.disabled` marker file instead of deleting it.
- **Update safety** — `UPDATE_ON_BOOT=true|false|hold`. `hold` freezes the game version until your mods are confirmed compatible and logs a loud banner when a patch is waiting. The world is backed up automatically before every update.
- **Backups built in** — on graceful shutdown, before updates, and on a schedule, with retention by count and age. One-command restore that snapshots the current world first.
- **Config from env** — `PalWorldSettings.ini` is generated from `.env` (40+ mapped settings, `OPT_<IniKey>` passthrough for everything else), and `config/persist/` pins any file the game keeps resetting.
- **Admin without ceremony** — a `pal-up` CLI inside the container: player list, broadcast, kick/ban, save-now, update check, backup management, all against the server's local REST API.
- **Web panel** — sign in with the admin password at `http://<host>:3000`: connect addresses for your players, live server status, game version and one-click updates, online players with kick/ban/unban, loaded mods and LogicMods with enable/disable toggles, backups with one-click create and rollback, and an admin page bundling server controls (restart/stop/broadcast with player warnings), the live server log, read-only server state, and a grouped, searchable settings editor with diff-before-apply. Sessions persist via cookie until you sign out. The panel needs **no docker.sock** — it drives the game through its REST API and the shared data volume.

## Quickstart

Requirements: Linux x86_64, Docker with the compose plugin, ~25 GB free disk, 16 GB RAM recommended.

```bash
git clone https://github.com/s-kiu/pal-up.git && cd pal-up
cp .env.example .env
# edit .env — at minimum set ADMIN_PASSWORD

docker compose up -d --build
docker compose logs -f palworld
```

First start downloads the ~15 GB server from Steam — game files can't ship
inside the image, and the download is one-time. It is stored in a Docker
**named volume** (`palworld-data`), managed by Docker outside this project
folder — you won't see it here, and it survives rebuilds, with later game
updates fetching deltas only. Only `mods/`, `paks/`, `logicmods/` and
`backups/` live in the project folder itself.

The build fetches the pinned UE4SS release and verifies it against the checksum in [ue4ss.lock](packages/server-image/ue4ss/ue4ss.lock) — nothing is ever downloaded at container runtime.

Then connect from Palworld: **Join Multiplayer Game** → `<host-ip>:8211` (open `8211/udp` in your firewall — and only that port). The admin panel is at `http://<host-ip>:3000` — sign in with your `ADMIN_PASSWORD`, and keep this port LAN/VPN-only.

Full walkthrough: [docs/quickstart.md](docs/quickstart.md).

## Installing mods

| You have | Put it in |
|---|---|
| Lua mod (folder with `scripts/main.lua`) | `./mods/CoolMod/` |
| Loose `.pak` mod | `./paks/` |
| LogicMod / Blueprint `.pak` | `./logicmods/` |

```bash
unzip CoolMod.zip -d mods/
docker compose restart palworld
```

Folder conventions, Linux caveats, and how mods survive game updates: [docs/mods.md](docs/mods.md).

## Building on top of it

Chat, joins and deaths are published as a JSON event stream — readable as a file
on the data volume or over HTTP from the panel — and actions go back the other
way, so an outside process can hand a player an item or message them privately.
Type `!ping` in game and the server broadcasts `pong`; the panel's **bridge**
page shows the live stream, the hooks behind it, and every player id ever seen.

That is the seam for bots, Discord relays, and anything else that wants to react
to what happens on the server. Contract and endpoints:
[docs/bridge.md](docs/bridge.md). Three runnable examples — a starter-kit
greeter, a death feed, and extra chat commands added without touching the
server: [examples/bridge/](examples/bridge).

The in-game half is a normal UE4SS mod, [mods/PalBridgeAgent](mods/PalBridgeAgent),
published as a standalone download for servers not running pal-up.

## Everyday operations

```bash
docker compose exec palworld pal-up palapi players    # who's online
docker compose exec palworld pal-up backup            # snapshot the world now
docker compose exec palworld pal-up backups           # list snapshots
docker compose exec palworld pal-up check-update      # is a Steam update available?
docker compose stop palworld                          # graceful: announce, save, stop, backup
```

Applying a held game update:

```bash
docker compose stop palworld
docker compose run --rm palworld update
docker compose start palworld
```

## Repository layout

```
pal-up/
├── compose.yaml              # the one command
├── .env.example              # all server & container settings
├── mods/                     # ← drop UE4SS Lua mods here (PalBridgeAgent ships in it)
├── examples/bridge/          # runnable consumers of the event/action API
├── paks/                     # ← drop loose .pak mods here
├── logicmods/                # ← drop Blueprint/LogicMod .paks here
├── backups/                  # world snapshots appear here
├── packages/
│   ├── server-image/         # the game server image (Dockerfile, entrypoint, UE4SS vendoring)
│   ├── daemon/               # panel backend (Fastify + TypeScript)
│   ├── panel/                # web UI (Angular)
│   └── shared/               # shared schemas & types
├── docs/                     # quickstart, mods, bridge, security, troubleshooting
└── .github/workflows/        # CI: shellcheck, bats, image build
```

The game install, world saves, and server state live in the `palworld-data`
Docker named volume, not in this folder — inspect it with
`docker volume inspect pal-up_palworld-data`.

The image is fully documented in [packages/server-image/README.md](packages/server-image/README.md), including the complete environment-variable reference.

## Development

```bash
npm run build:image            # build the game server image locally
npm run test:image             # shellcheck + bats unit tests for the image scripts
```

The 15 GB Steam download lives in the `palworld-data` Docker volume (see above), so it survives image rebuilds and iterating on the image is cheap.

## Security

Read [docs/security.md](docs/security.md) before exposing anything. Summary: only `8211/udp` is ever public; the admin REST API stays inside the compose network; the UE4SS binary is vendored and checksum-pinned, never fetched at runtime.

## License

[AGPL-3.0](LICENSE). The vendored UE4SS Linux port is MIT-licensed by its upstream authors. This project is not affiliated with Pocketpair.
