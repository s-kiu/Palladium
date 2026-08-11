# Leaderboards

Standings read from the tallies the game already keeps for each player. Six
boards, refreshed on a timer rather than on demand, so a busy server is not
re-reading every player's record each time somebody types `!lb`.

## Commands

| Command | Node | What it does |
|---|---|---|
| `!lb` | `leaderboards.check` | The default board, and the other names you can ask for. |
| `!lb level` | `leaderboards.level` | Highest level, most recently reached first on a tie. |
| `!lb playtime` | `leaderboards.playtime` | Most hours on this server. |
| `!lb captured` | `leaderboards.captured` | Most pals caught. |
| `!lb fished` | `leaderboards.fished` | Most fish caught. |
| `!lb crafted` | `leaderboards.crafted` | Most items crafted. |
| `!lb bosses` | `leaderboards.bosses` | Most bosses defeated, all types counted together. |

Every board answers with how long until the next refresh.

## Permission nodes

| Node | Default | Grants |
|---|---|---|
| `leaderboards.check` | allow | Use `!lb` at all. |
| `leaderboards.level` | allow | See the level board. |
| `leaderboards.playtime` | allow | See the playtime board. |
| `leaderboards.captured` | allow | See the captures board. |
| `leaderboards.fished` | allow | See the fishing board. |
| `leaderboards.crafted` | allow | See the crafting board. |
| `leaderboards.bosses` | allow | See the boss board. |

One node per board, so a board that does not suit your server can be denied
without taking the rest with it.

## Settings

| Key | Default | What it means |
|---|---|---|
| `refresh_minutes` | `5` | How often standings are re-read. `!lb` never triggers a refresh; it answers from the last one. |
| `top` | `3` | How many names each board lists. |
| `default_board` | `level` | Which board a bare `!lb` shows — one of `level`, `playtime`, `captured`, `fished`, `crafted`, `bosses`. |

## Files

```
mods/Leaderboards/
├── mod.lua                   the mod — replaced when you update it
└── settings.example.config   shipped and commented; reference material

Mods/Palladium/mods/Leaderboards/
├── settings.config           yours — created from the example on the first load
│                             that finds none, never overwritten after; its
│                             [nodes] section holds your node defaults
└── generated/commands.ref    what this mod added, written by the framework
```

Standings are not stored: they are read from the game's own per-player tallies
at each refresh, so uninstalling the mod loses nothing.

## Install

Drop the folder into `./mods` — or your server's UE4SS `Mods` folder if you are
not running Pal-Up — and restart. Needs Palladium and nothing else.
