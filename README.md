# pal-up + Palladium

**A modded Palworld dedicated server for Linux in one `docker compose up` — and a modding API for building on top of it.**

Two halves of one project:

- **pal-up** — the server. Palworld's official mod system supports **Windows** dedicated servers only, so pal-up brings server-side modding to Linux by integrating the native [UE4SS Linux port](https://github.com/BlackBookOfficial/ue4ss-linux-palworld) into a batteries-included container: mod loading, folder routing, config generation, safe updates, backups and a web panel, driven by three drop-in folders and one `.env` file.
- **[Palladium](mods/Palladium)** — the modding framework. A UE4SS Lua mod that publishes in-game events (chat, joins, deaths, pal spawns) and executes actions (message, give item, teleport, heal, stats, spawn) so external programs in any language can react to the server and act on it. It ships inside pal-up with a full GUI, and is [released standalone](https://github.com/s-kiu/pal-up/releases) for servers not running pal-up.

If you just want a Palworld server that runs mods, use pal-up. If you want to *build* something — a Discord relay, a shop bot, an event-driven mod — that is what Palladium is for, and the panel gives you a UI for all of it before you write a line of code.

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
- **A modding API with a GUI** — [Palladium](mods/Palladium) turns the server into a platform: subscribe to in-game events over HTTP, send actions back, from any language. The panel's **Palladium** page renders every capability as a form with searchable pickers (2,400+ items, 750+ pal species, tier-coloured traits, saved locations, known players), a filterable live event stream, and a stats editor for players and pals. Its **permissions** page adds groups, roles and per-player overrides that other mods can register their own nodes into.

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

## Palladium — building on top of it

[Palladium](mods/Palladium) is the in-game half: a UE4SS Lua mod that publishes
events and executes actions. The panel is the other half, exposing both over
HTTP with tokens, a database and permissions. Together they make the server
programmable.

**Events**: `player.chat`, `player.join` (with `firstEver`), `player.death`
(with killer), `player.respawn`, `player.leave`, `npc.spawn`.
**Actions**: message, give item, teleport, heal, read/set stats, tags, spawn and
inspect pals, plus permissions, groups and saved locations.

Everything goes through one verb, from any language:

```bash
curl -H "Authorization: Bearer $TOKEN" -X POST http://localhost:3000/api/bridge/call \
  -H 'content-type: application/json' \
  -d '{"type":"player.give_item","target":"<player id>","data":{"item":"PalSphere","count":5}}'
```

Type `!ping` in game and the server broadcasts `pong`. Grant a group the
`chatshop.kit` node and only its members can use `!kit`. Constrain a permission
to *"may spawn, but only Lamball below level 20"* and the server enforces it.

- Protocol and endpoints: [docs/bridge.md](docs/bridge.md)
- Every capability, generated from one manifest: [docs/bridge-reference.md](docs/bridge-reference.md)
- Runnable examples — starter-kit greeter, death feed, chat commands: [examples/bridge/](examples/bridge)
- The mod on its own, for servers not running pal-up: [mods/Palladium](mods/Palladium)

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
├── mods/
│   └── Palladium/            # the modding framework (ships here, released standalone)
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
