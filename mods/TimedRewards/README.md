# TimedRewards

Reach an hour mark on this server, earn that mark's reward. Spheres at hour
one, gold at hour five — the ladder is the operator's to define.

A Palladium mod: one `mod.lua` that returns a table. Palladium counts playtime
minute by minute and fires `player.hour` when a played hour completes; this
mod reacts to it and owns no timer of its own.

## Install

Drop the folder into `./mods` (or your server's UE4SS `Mods` folder if you are
not running pal-up, plus a line in `Mods/Palladium/mods.list`) and restart the
server. Palladium reports it on startup and lists it in the panel's mods page.

Needs Palladium 4.10.0 or newer. Nothing else — no panel, no token, no
process to run.

## Settings

Edit them in `settings.config` beside the mod — it appears on the first load,
copied from the shipped `settings.example.config`, and edits apply within
seconds on a running server, no restart. Mod updates never touch it.

| Setting | Default | Meaning |
|---|---|---|
| `rewards.N.hours` | `1`, `5`, `10` | The mark: total hours played on this server |
| `rewards.N.item` | `PalSphere`, `Money` | What that mark pays. Item ids are the game's internal names |
| `rewards.N.count` | `5`, `500`, `1500` | How much |

Mentioning `rewards` in the file replaces the whole ladder — list every mark
you want.

## Commands

`!rewards` — hours played, marks claimed, and where the next reward waits.

## The permissions

`timedrewards.reward` and `timedrewards.check`, both allowed by default. Deny
`timedrewards.reward` for the default group and grant it to a group to make
the ladder a perk.

## Where the claims live

In the `claimed` collection, declared by the mod and held in its own folder —
one record per player: which marks were paid, and when. The panel lists it,
`data.list timedrewards.claimed` reads it from anywhere, and deleting the
folder removes the mod and its records.

## Notes

- Settlement, not scheduling: the mod pays the gap between hours played and
  marks claimed, whenever it looks. A restart never pays twice, downtime owes
  rather than loses, and a mark added below what someone already played is
  paid at the next sight of them.
- Playtime counts only while actually online, credited by the agent one
  minute at a time — a crash costs at most the minute in progress.
