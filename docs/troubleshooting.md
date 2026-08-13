# Troubleshooting

Look at the logs first — the entrypoint narrates every step:

```bash
docker compose logs -f --tail 200 palworld
```

## Install / startup

**"ADMIN_PASSWORD is not set" and the container exits.**
Intentional. Set it in `.env`, `docker compose up -d`.

**First boot seems stuck.**
The Steam download is ~15 GB and SteamCMD's progress output is bursty; on slow
lines this takes 30+ min and the container shows `starting` (healthcheck
grace period). Watch `docker compose logs -f` and disk usage
(`docker system df -v | grep palworld-data`).

**SteamCMD fails repeatedly (`0x202`, `0x606`, disk write failure…).**
Usually disk space (need ~20 GB free under Docker's data root) or flaky
network. The entrypoint retries 3×. Check `df -h`, retry, and if a previous
crash left the depot half-written run once with `VALIDATE_ON_BOOT=true`.

**`steamclient.so` warnings in the log.**
Harmless if the server continues; the entrypoint links it into
`~/.steam/sdk64` automatically.

**Container is `unhealthy` but players can join.**
The healthcheck needs the REST API. If you set `REST_API_ENABLED=false` (or
`SETTINGS_MODE=manual` without enabling it in your own ini) the check falls
back to process-only — make sure you didn't disable the API by accident;
graceful shutdown quality degrades without it (plain SIGTERM instead of
announce+save).

**Permission denied on `./mods` / `./backups` from the host.**
Set `PUID`/`PGID` in `.env` to your user (`id -u` / `id -g`) and restart; the
entrypoint re-chowns on boot.

## Mods

**Mod does nothing.**
Checklist, in order:

1. `docker compose exec palworld pal-up bash -c 'cat /palworld/server/Mods/mods.txt'`
   — is the mod listed with `: 1`? If it's missing, the folder name is
   probably invalid (letters/digits/`_ . -` only, no spaces) — the log warns
   about skipped names.
2. Is it actually a *server-side* mod? Client-visual mods must be installed
   on players' machines ([mods.md](mods.md)).
3. Structure right for its kind? A Lua mod is `mods/<Name>/Scripts/main.lua`;
   a Palladium mod is `mods/<Name>/mod.lua`; a script mod is
   `mods/<Name>/mod.json`. Unzip mishaps are the #1 cause, in both directions:
   an extra nesting level (`mods/CoolMod/CoolMod/Scripts/…`), or a flat
   archive that dumped its files loose into `mods/` — create the mod folder
   and move them inside. A zip file itself in `mods/` is ignored.
4. UE4SS actually active? Startup log must say `starting PalServer WITH
   UE4SS`. If it says the image was built without UE4SS, rebuild the image —
   the checksum pin in `packages/server-image/ue4ss/ue4ss.lock` must be
   present at build time, and `UE4SS_OMIT` must not be set.
5. Check UE4SS's own log: `/palworld/server/UE4SS.log`.

**A Palladium mod isn't loading.** It never appears in `mods.txt` — UE4SS
doesn't load it, Palladium does — so check these instead:

1. The panel's mods page lists every mod Palladium reported, with the reason
   for any that failed: a `mod.lua` that returns nothing, will not parse, or
   declares a permission node outside its own namespace.
2. Is it in the list Palladium reads? `cat
   /palworld/server/Mods/Palladium/mods.list` — Pal-Up regenerates it on every
   boot from `./mods`, skipping folders with a `.disabled` marker.
3. `UE4SS.log` carries Palladium's own lines, including which route it used to
   find mods and what each one registered.
4. A handler for an event that does not exist is reported there too, and on
   the mods page — that one loads fine and simply never fires.

**Log says `error while loading shared libraries` right after "starting PalServer".**
A system library the UE4SS build links against is missing from the image (the
startup log names it, and newer images fall back to unmodded mode with a
warning instead of exiting). Rebuild with the current Dockerfile
(`docker compose build --no-cache palworld`); if it persists, report the
library name in an issue.

**Server dies seconds-to-minutes after every start while mods are on**
(clients see "connection timed out" right after joining, logs show
`server exited on its own` with rc=134/139 on a regular rhythm).
That's the mod loader aborting on a game build it doesn't support — typically
right after a game patch. The container detects this on its own: after 3
rapid crashes it restarts **unmodded** with a banner (`MODS_AUTO_FALLBACK`,
on by default), so players can keep playing. To get mods back: watch the
UE4SS Linux port for a release matching your game build, then
`ue4ss/vendor.sh --pin <new-tag>` and rebuild — the crash counter resets
automatically when the loader or game build changes.

**Server crashes on boot after adding a mod.**
Set `MODS_ENABLED=false`, restart. Boots fine → it's a mod: bisect with
`.disabled` markers. Also check `server/UE4SS.log` if present.

**A mod's config keeps resetting.**
Put your copy of the file under `config/persist/<server-relative-path>` —
it's restored on every boot ([mods.md](mods.md), "Files that keep resetting").

**Chat commands crash a standalone Linux server (signal 8 / exit 136).**
Seen on the upstream `ue4ss-linux-palworld` build: the server boots, hooks
register, then the first `!command` typed in chat takes the process down with
a floating-point exception. That build is missing part of the Linux fix set
([upstream issue #11](https://github.com/BlackBookOfficial/ue4ss-linux-palworld/issues/11))
— most relevantly the bundled `UE4SS_Signatures/` address overrides. Without
them the loader can resolve an engine function to the wrong address, and the
first real engine call Lua makes — sending your chat reply — executes
something that was never meant to run.

Use the release Pal-Up itself pins:
[`Qiiks/ue4ss-linux-palworld`, tag `v1.0.3-palworld-linux`](https://github.com/Qiiks/ue4ss-linux-palworld/releases)
— and keep the `UE4SS_Signatures/` directory from that archive next to the
loader, it is required, not optional. To confirm this is your case first:
type `!zzz` (any unknown command) in chat. Its reply is one short line — if
that also crashes, message length is irrelevant and it is the loader's
engine-call path; the same crash would eventually surface without Palladium.

## Updates

**"GAME UPDATE AVAILABLE — NOT APPLIED".**
That's `UPDATE_ON_BOOT=hold` doing its job. Apply when ready:
`docker compose stop palworld && docker compose run --rm palworld update && docker compose start palworld`.

**`check-update` says `could not reach Steam`.**
Transient Steam/network hiccup; the result is cached 5 min — try again after.

**Players can't join after a game patch ("version mismatch").**
Client updated, server held. Either apply the update (above) or have players
roll back / wait. This is the trade-off `hold` buys you.

## Backups & restore

**`restore` refuses to run.**
It requires the server to be stopped: `docker compose stop palworld` first,
then `docker compose run --rm palworld restore <archive|latest>`.

**Backups are missing.**
`pal-up backups` lists `./backups/` on the host. Scheduled backups need
`BACKUP_INTERVAL_MINUTES > 0`; retention (`BACKUP_KEEP_COUNT`, default 14)
may have pruned old ones.

## Still stuck?

Open an issue with: `docker compose logs --tail 300 palworld`, your `.env`
minus passwords, host distro + `docker --version`, and what changed last.
