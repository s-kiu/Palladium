# GoldStreak

Every fifth respawn pays 50 gold. Dying is going to happen; this makes the
fifth time mildly worth it.

A Palladium mod: one `mod.lua` that returns a table. Palladium loads it inside
the game, registers the permission node it declares, and calls its handlers.

## Install

Drop the folder into `./mods` (or your server's UE4SS `Mods` folder if you are
not running pal-up) and restart the server. Palladium reports it on startup and
lists it in the panel's mods page.

Needs Palladium. Nothing else — no panel, no token, no process to run.

## Settings

Edit them in `mod.lua`:

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

## Where the count lives

In a tag on the player, held in Palladium's own store, so a streak survives a
restart and this mod keeps no state of its own. Tags are namespaced per mod:
this one is `goldstreak.respawns`, and no other mod can collide with it.

## Notes

- The payout is only announced once the gold is verifiably in the inventory —
  `pal.give` counts before and after, because the engine accepts an unknown
  item id and silently adds nothing. A payout that did not arrive is logged.
- Handlers run off the engine thread, from a queue Palladium drains, so a slow
  handler here delays other mods and never a game hook.
