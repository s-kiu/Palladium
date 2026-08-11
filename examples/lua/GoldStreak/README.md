# GoldStreak

Pays a reward every Nth respawn. A death counter kept per player in the mod's
own store, and a payout when it comes round — the smallest complete mod in
these examples, and the one to read first.

## Commands

| Command | Node | What it does |
|---|---|---|
| `!streak` | `goldstreak.reward` | Says how many respawns are left until your next payout. |

## Permission nodes

| Node | Default | Grants |
|---|---|---|
| `goldstreak.reward` | allow | Earn the streak reward, and ask about it. |

Deny it to a group and its members still die — they just stop being paid.

## Settings

| Key | Default | What it means |
|---|---|---|
| `every` | `5` | Pay on every Nth respawn. |
| `item` | `Money` | Item id to pay. |
| `count` | `50` | How many of it. |

Item ids are the game's internal names — gold is `Money`.

## Files

```
mods/GoldStreak/
├── mod.lua                   the mod — replaced when you update it
└── settings.example.config   shipped and commented; reference material

Mods/Palladium/mods/GoldStreak/
├── settings.config           yours — created from the example on the first load
│                             that finds none, never overwritten after; its
│                             [nodes] section holds your node defaults
├── .data                     the respawn count per player
└── generated/commands.ref    what this mod added, written by the framework
```

## Install

Drop the folder into `./mods` — or your server's UE4SS `Mods` folder if you are
not running Pal-Up — and restart. Needs Palladium and nothing else.
