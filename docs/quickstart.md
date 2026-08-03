# Quickstart — zero to modded Palworld server

Tested target: Ubuntu 24.04, x86_64. Any Linux with Docker ≥ 24 and the
compose plugin works the same way. **Not** supported: ARM (Raspberry Pi) — the
UE4SS Linux build is x86_64 only.

## 0. Requirements

- 4+ CPU cores, **16 GB RAM recommended** (the server eats memory over time)
- ~25 GB free disk
- Ports: `8211/udp` reachable by your players (that's the only one!)

About the disk space: the Palworld dedicated server (~15 GB) is downloaded
from Steam on first start — game files can't be redistributed inside a Docker
image, so every server obtains them from Steam directly. The download is
one-time and goes into a Docker **named volume** called `palworld-data`.
That volume is managed by Docker and does not appear as a folder in the
project directory (find it with `docker volume inspect pal-up_palworld-data`);
it survives container recreation and image rebuilds, and later game updates
only fetch deltas. Peak usage during the install is higher than the final
size because Steam stages compressed chunks next to the files it writes,
hence the 25 GB headroom.

```bash
# Ubuntu 24.04: install Docker if you don't have it
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2
sudo usermod -aG docker "$USER" && newgrp docker
```

## 1. Get the project

```bash
git clone https://github.com/s-kiu/pal-up.git && cd pal-up
cp .env.example .env
```

Edit `.env`:

```bash
ADMIN_PASSWORD=change-me-to-something-long-and-random   # required
SERVER_NAME=My Friends' Server
PUID=1000   # your uid/gid → `id -u` / `id -g`, so ./mods stays editable
PGID=1000
```

## 2. Start

```bash
docker compose up -d --build
docker compose logs -f palworld
```

The image build fetches the UE4SS mod loader from its pinned release and
verifies it against the checksum recorded in
[`ue4ss.lock`](../packages/server-image/ue4ss/ue4ss.lock) — the running
container never downloads anything from mod-loader upstreams. Prefer a fully
offline build (or want to inspect the artifact first)? Run
`./packages/server-image/ue4ss/vendor.sh` beforehand and the build uses the
local copy. Want a vanilla, unmodded server? Set `MODS_ENABLED=false` in
`.env`.

First boot downloads ~15 GB from Steam — grab a coffee. You're up when the log
shows the startup summary and `docker compose ps` reports the container
healthy. Players connect in Palworld via **Join Multiplayer Game** →
`<your-ip>:8211`.

If the server has a firewall:

```bash
sudo ufw allow 8211/udp
```

Do **not** open 8212 (admin API) or 25575 (RCON) — see
[security.md](security.md).

The **web panel** is now at `http://<your-ip>:3000` — sign in with your
`ADMIN_PASSWORD`. It shows live status, players (kick/ban), mods, and
backups, and can apply game updates and roll back backups with one click.
The session sticks (cookie) until you sign out. The panel speaks plain HTTP:
keep port 3000 on your LAN or behind a VPN, never open it to the internet.

## 3. Install a mod

> **Heads-up:** mods are currently non-functional on the latest Palworld
> build — the UE4SS Linux port doesn't support it yet
> ([upstream issue](https://github.com/BlackBookOfficial/ue4ss-linux-palworld/issues/1))
> and the server automatically runs unmodded until a compatible release is
> pinned. The steps below are unchanged once that lands.

Three folders in the project root, one per mod type
(details: [mods.md](mods.md)):

| You have | Put it in | Ends up in |
|---|---|---|
| Lua mod (folder with `scripts/main.lua`) | `./mods/CoolMod/` | UE4SS `Mods/` |
| Loose `.pak` mod | `./paks/` | `Pal/Content/Paks/~mods/` |
| LogicMod / Blueprint `.pak` | `./logicmods/` | `Pal/Content/Paks/LogicMods/` |

```bash
unzip CoolMod.zip -d mods/          # → mods/CoolMod/scripts/main.lua
docker compose restart palworld     # syncs mods + regenerates mods.txt
```

Disable without deleting: `touch mods/CoolMod/.disabled` and restart.

## 4. Everyday operations

```bash
docker compose exec palworld pal-up palapi players     # who's online
docker compose exec palworld pal-up palapi announce "backup in 1 min"
docker compose exec palworld pal-up backup             # manual snapshot
docker compose exec palworld pal-up backups            # list snapshots
docker compose exec palworld pal-up check-update       # update available?
docker compose stop palworld                           # graceful stop:
                                                       # warns players, saves,
                                                       # stops, backs up
```

Backups land in `./backups/` as plain `tar.gz` — copy them anywhere.
Scheduled backups + retention are on by default (`BACKUP_INTERVAL_MINUTES=240`,
keep newest 14); tune in `.env`.

## 5. Game updates without breaking mods

Palworld patches regularly break UE4SS and mods. Your defense is `hold` mode:

```bash
# in .env:
UPDATE_ON_BOOT=hold
```

The container then **never updates on its own** — when Steam has a new build
it prints a loud banner in the logs and keeps running the version your mods
work with. When you're ready (mods updated, UE4SS pin bumped if needed):

```bash
docker compose stop palworld
docker compose run --rm palworld update     # auto-backups first
docker compose start palworld
```

A backup is taken before every update regardless of mode
(`BACKUP_BEFORE_UPDATE=true`).

## 6. Restore a backup

```bash
docker compose exec palworld pal-up backups           # pick one, or use "latest"
docker compose stop palworld
docker compose run --rm palworld restore latest
docker compose start palworld
```

Restore refuses to run while the server is up and snapshots the current world
first (`pre-restore` tag), so a mistaken restore is itself reversible.

Something broke? [troubleshooting.md](troubleshooting.md).
