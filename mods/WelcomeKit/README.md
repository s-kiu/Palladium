# WelcomeKit

Players joining the server for the first time get a private welcome and a
starter kit, once ever. Returning players get a greeting. Who receives a kit is
a single permission node, allowed by default.

A Palladium mod: one `mod.lua`. No panel, no token, no process.

## Install

Drop the folder into `./mods` (or your server's UE4SS `Mods` folder if you are
not running Pal-Up) and restart the server.

Needs Palladium. Nothing else.

## Settings

Edit them in `settings.config` beside the mod — it appears on the first
load, copied from the shipped `settings.example.config`, and edits apply
within seconds on a running server, no restart. Mod updates never touch it.


| Setting | Default | Meaning |
|---|---|---|
| `items` | 10 × `PalSphere`, 5 × `Pan` | The kit. Item ids are the game's internal names — bread is `Pan`, medical supplies are `Medicines`, gold is `Money` |
| `announce` | `true` | Broadcast *"X just joined for the first time"* to everyone online |

## The permission

`welcomekit.kit`, allowed by default. To hand kits to some players only, deny it
for the default group in `permissions.config` and allow it for the group that
should have it. A first-time player without the node is still welcomed and still
announced; they just get no items.

```ini
[groups default]
deny = welcomekit.kit

[groups regulars]
allow = welcomekit.kit
```

## Behaviour

- **Once ever, not once per session.** "First time" is answered from Palladium's
  player registry, which outlives the event file and every reboot. The claim is
  a tag on the player, so a crash, a restart or a second copy of this mod cannot
  produce a second kit.
- **A kit that did not arrive is not a claimed kit.** The engine accepts a grant
  of an unknown item id and reports success having added nothing, so every item
  is counted before and after. If any of it fails to land, the player is told,
  the failing id goes to the log, and the claim is *not* written — so a typo in
  `items` shows up as a complaint rather than a silent loss.
- Joins that happen while the mod is disabled are not backfilled — those players
  are already in the world, and an admin can hand them a kit directly.
