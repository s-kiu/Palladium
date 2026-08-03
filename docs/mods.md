# Mods — folder conventions & how loading works

## The three mod types (and where they go)

| Type | Looks like | Drop into | Synced to (in container) | Needs UE4SS |
|---|---|---|---|---|
| **Lua** | folder with `scripts/main.lua` | `./mods/<ModName>/` | `server/Mods/<ModName>/` | yes |
| **Loose .pak** | a single `SomeMod_P.pak` (sometimes with `.ucas`/`.utoc`) | `./paks/` | `Pal/Content/Paks/~mods/` | no |
| **LogicMod** (Blueprint) | a `.pak` the author calls a LogicMod / BP mod | `./logicmods/` | `Pal/Content/Paks/LogicMods/` | yes (BPModLoaderMod) |

Rules of thumb when a download page doesn't say which type it is:

- Archive contains `scripts/main.lua` (or `main.lua` + `enabled.txt`) → **Lua**.
- Archive contains only a `.pak` (± `.ucas`/`.utoc` siblings) and the page
  says "LogicMods folder" → **LogicMod**; otherwise → **loose .pak**.
- Archive contains a `dlls/` folder → Windows-only C++ mod, **will not work**
  (see below).

Sync happens on every container start: `docker compose restart palworld`
after changing mod folders. Mods removed from `./mods` are removed from the
server; folders pal-up didn't put there (UE4SS's bundled mods) are left
alone.

## Enabling / disabling

`server/Mods/mods.txt` is regenerated on every boot (`MODS_TXT_MODE=managed`):
UE4SS's bundled defaults + every folder in `./mods`, enabled unless a
`.disabled` marker exists:

```bash
touch mods/CoolMod/.disabled     # keep the files, skip loading
rm    mods/CoolMod/.disabled     # re-enable
docker compose restart palworld
```

This kills the classic "my mods.txt reset after restart" problem: the file is
*supposed* to be regenerated — from state you control. Power users who want
exotic load orders set `MODS_TXT_MODE=manual` and own the file themselves.

Note: a `enabled.txt` file *inside* a mod folder force-enables it in UE4SS
regardless of `mods.txt` — some mods ship one. Delete it from your copy in
`./mods` if you want `.disabled` to work for that mod.

## Linux caveats (read before reporting a broken mod)

- **C++ mods must be Linux-native.** The Linux UE4SS cannot load Windows
  `.dll` files; a C++ mod needs to be recompiled by its author as a Linux
  `.so` (loaded from `libs/` instead of `dlls/`). Most aren't (yet).
- **Client-side mods don't belong on the server.** Anything visual (UI,
  textures, models seen only by players) goes on the *player's* machine. A
  server-side mod changes rules/spawns/logic for everyone.
- **PalSchema** mods (JSON-based tweaks) are reported to work on Linux
  servers; treat version compatibility carefully and test — the framework
  itself historically depends on UE4SS.
- **The official Pocketpair mod system** (`Mods/Workshop` + `PalModSettings.ini`,
  added in 1.0) supports **Windows dedicated servers only** — that's exactly
  why this project vendors the community UE4SS Linux port instead. If a future
  patch enables it on Linux, drop your `PalModSettings.ini` into
  `config/persist/` (see below) and it will survive restarts.

## Surviving game updates

Game patches routinely break UE4SS (memory offsets move). pal-up's model:

1. Run with `UPDATE_ON_BOOT=hold` — the game version stays put until *you*
   decide, no matter how often the container restarts.
2. When a patch lands, check the [UE4SS Linux port](https://github.com/BlackBookOfficial/ue4ss-linux-palworld)
   for a compatible release, then re-pin: `./packages/server-image/ue4ss/vendor.sh --pin <new-tag>`
   and rebuild the image.
3. `docker compose run --rm palworld update` (auto-backup happens first),
   start, and test with `MODS_ENABLED=true`. If the server crashes on boot,
   flip `MODS_ENABLED=false` to confirm it's mod-related, then bisect with
   `.disabled` markers.

## Files that keep resetting

Any config file the game or a mod regenerates can be pinned: put your copy
under `config/persist/` (inside the data volume) at its server-relative path,
e.g.:

```
config/persist/Pal/Binaries/Linux/PalModSettings.ini
config/persist/UE4SS-settings.ini
```

Persisted files are copied over the server tree on every boot, *after*
pal-up's own config generation — your file always wins.

## Where do I even get mods?

Nexus Mods and CurseForge, "Palworld" section. pal-up deliberately has no
automatic downloader (Nexus Mods' API terms restrict automated downloads);
download archives yourself and drop them in.
