# Leaderboards

Who leads the server. `!lb` answers with the top levels — from the last
scheduled refresh, never computed because somebody asked.

A Palladium mod: one `mod.lua` that returns a table. It is the reference for
polling-style mods — standings are re-read from the engine only when the
minute divides the operator's interval, so no player holds a lever on the
server by spamming a command.

## Install

Drop the folder into `./mods` (or your server's UE4SS `Mods` folder if you are
not running pal-up, plus a line in `Mods/Palladium/mods.list`) and restart the
server. Palladium reports it on startup and lists it in the panel's mods page.

Needs Palladium 4.11.0 or newer (the `clock.minute` event and the plain
`level` field on `player.stats` live there). Nothing else.

## Settings

Edit them in `settings.config` beside the mod — it appears on the first load,
copied from the shipped `settings.example.config`, and edits apply within
seconds on a running server, no restart. Mod updates never touch it.

| Setting | Default | Meaning |
|---|---|---|
| `refresh_minutes` | `5` | How often standings are re-read from the engine |
| `top` | `3` | How many names `!lb` lists |

## Commands

`!lb` — the current level leaders, with each player's last known level.

## The permission

`leaderboards.check`, allowed by default.

## Where the standings live

In the `standings` collection, declared by the mod and held in its own
folder — one record per player ever seen: name, last known level, and when
they were last read. A join puts a player on the board immediately; going
offline keeps their last known level rather than dropping them.

## Notes

- The command reads the collection and nothing else — the engine is touched
  only on the cadence. That is the pattern this mod exists to demonstrate.
- Levels come from `player.stats`, which answers for online players only;
  offline players simply keep the level they were last seen with.
