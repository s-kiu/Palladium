# TimedRewards

Pays out at hour marks of total time played on this server. Playtime comes from
Palladium's own store, so it survives restarts, and each mark is claimed once
per player however often they rejoin.

## Commands

| Command | Node | What it does |
|---|---|---|
| `!rewards` | `timedrewards.check` | Your hour marks: what you have claimed, and how far to the next. |

## Permission nodes

| Node | Default | Grants |
|---|---|---|
| `timedrewards.reward` | allow | Earn the hour-mark payouts. |
| `timedrewards.check` | allow | Ask where you are on the ladder. |

Two nodes rather than one, so a group can watch the ladder without earning on
it — or earn on it without being able to ask.

## Settings

| Key | Default | What it means |
|---|---|---|
| `rewards.<n>.hours` | `1`, `5`, `10` | Total hours played that unlocks this mark. |
| `rewards.<n>.item` | `PalSphere`, `Money`, `Money` | Item id to pay at it. |
| `rewards.<n>.count` | `5`, `500`, `1500` | How many of it. |

Mentioning `rewards` at all replaces the whole ladder, so list every mark you
want — not only the ones you changed. Item ids are the game's internal names.

## Files

```
mods/TimedRewards/
├── mod.lua                   the mod — replaced when you update it
└── settings.example.config   shipped and commented; reference material

Mods/Palladium/mods/TimedRewards/
├── settings.config           yours — created from the example on the first load
│                             that finds none, never overwritten after; its
│                             [nodes] section holds your node defaults
├── .data                     which marks each player has claimed
└── generated/commands.ref    what this mod added, written by the framework
```

## Install

Drop the folder into `./mods` — or your server's UE4SS `Mods` folder if you are
not running Pal-Up — and restart. Needs Palladium and nothing else.
