# GoldStreak

Every fifth respawn pays 50 gold. Dying is going to happen; this makes the
fifth time mildly worth it.

A Palladium mod: one `mod.lua` that returns a table. Palladium loads it inside
the game, registers the permission node it declares, and calls its handlers.

## Install

Drop the folder into `./mods` (or your server's UE4SS `Mods` folder if you are
not running Pal-Up) and restart the server. Palladium reports it on startup and
lists it in the panel's mods page.

Needs Palladium. Nothing else — no panel, no token, no process to run.

## What appears in the folder

```
mods/GoldStreak/
├── mod.lua                   the mod itself — replaced when you update it
├── settings.example.config   shipped and commented; reference material
└── settings.config           yours — created from the example on the first
                              load that finds none, never overwritten after
```

The streak count is not here: it lives in a tag on the player in Palladium's
own store, so deleting this folder is a clean uninstall.

## Settings

Edit them in `settings.config` beside the mod — it appears on the first
load, copied from the shipped `settings.example.config`, and edits apply
within seconds on a running server, no restart. Mod updates never touch it.


| Setting | Default | Meaning |
|---|---|---|
| `every` | `5` | Pay out on every Nth respawn |
| `item` | `Money` | What to pay in. `Money` is the game's id for gold |
| `count` | `50` | How much |

## Commands

`!streak` — how many respawns you have banked, and how many until the next
payout.

## The permission

`goldstreak.reward`, allowed by default. Deny it for the default group and
grant it to a VIP group to make the streak a perk instead of a baseline —
Palladium resolves per-player overrides, then groups by weight, then the
default group, then this default.

The node itself is declared in `mod.lua`, which is what keeps this mod one
file. A mod with more nodes can move them into a `permissions.config` beside
it instead — [TimedRewards](../TimedRewards) does, and
[docs/mods.md](../../../docs/mods.md) explains the trade.

## Where the count lives

In a tag on the player, held in Palladium's own store, so a streak survives a
restart and this mod keeps no state of its own. Tags are namespaced per mod:
this one is `goldstreak.respawns`, and no other mod can collide with it.

## Notes

- The payout is only announced once the gold is verifiably in the inventory —
  `player.give_item` counts before and after, because the engine accepts an unknown
  item id and silently adds nothing. A payout that did not arrive is logged.
- Handlers run off the engine thread, from a queue Palladium drains, so a slow
  handler here delays other mods and never a game hook.
