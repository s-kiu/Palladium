# WelcomeKit

Players joining the server for the first time get a private welcome and a
starter kit, once ever. Returning players get a greeting. Who receives a kit is
a single permission node, allowed by default.

## Install

Drop the folder into `./mods` and it starts within ten seconds — no restart,
because nothing about it runs inside the game. The panel's mods page shows it
running, and `welcomekit.kit` appears on the permissions page.

## Settings

`mod.json` carries them, and the panel picks up an edit on its next scan:

| Setting | Default | Meaning |
|---|---|---|
| `items` | 10 × `PalSphere`, 5 × `Pan` | The kit. Item ids are the game's internal names — bread is `Pan`, medical supplies are `Medicines` |
| `announce` | `true` | Broadcast *"X just joined for the first time"* to everyone |

## The permission

One node, `welcomekit.kit`, registered from the manifest and defaulting to
`allow`. To hand kits to some players only, deny it for the default group on
the panel's permissions page and grant it to the group that should have it. A
first-time player without the node is still welcomed and announced; they just
get no items.

## Behaviour

- The claimed flag is a player tag in the panel's database, so a crash, a
  restart or a second copy of this mod cannot hand out two kits.
- The game accepts a grant of an unknown item id and silently adds nothing, so
  every item is counted before and after. A kit that does not fully arrive is
  reported to the player, logged, and *not* marked as claimed.
- Joins that happen while the mod is stopped are not backfilled — those players
  are already in the world, and the panel can give them a kit by hand.
