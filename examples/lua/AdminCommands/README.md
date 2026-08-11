# AdminCommands

Moderator commands in chat: teleport, give, slay, god, freeze, fly and mute.
Every one is gated by a node of its own, all denied by default, so installing
this mod hands nobody anything until you say who.

## Commands

| Command | Node | What it does |
|---|---|---|
| `!tp @Name` | `admincommands.tp` | Go to them. `!tp @Name @Other` sends the first to the second. |
| `!give @Name <item> [count]` | `admincommands.give` | Hand items over. Item ids are the game's internal names. |
| `!slay @Name` | `admincommands.slay` | Kill them outright. |
| `!god @Name` | `admincommands.god` | Toggle near-invulnerability. `off` to be explicit. |
| `!freeze @Name` | `admincommands.freeze` | Hold them where they stand. Toggle. |
| `!fly @Name` | `admincommands.fly` | Toggle flight. Needs the [client mod](../../client/AdminControlsClient) on that player's machine. |
| `!mute @Name` | `admincommands.mute` | Ignore their chat **commands**. Toggle. |

Every switch toggles: `!god @Name` turns it on, again turns it off. An explicit
`on` or `off` still wins, because a script or a second admin should be able to
say what it means rather than flip whatever it finds. The state lives in this
mod's own collections, so it survives a restart and two admins see the same
answer.

## Permission nodes

| Node | Default | Grants |
|---|---|---|
| `admincommands.tp` | deny | Teleport yourself, or one player to another. |
| `admincommands.give` | deny | Hand items to a player. |
| `admincommands.slay` | deny | Kill a player. |
| `admincommands.god` | deny | Turn near-invulnerability on and off. |
| `admincommands.freeze` | deny | Hold a player in place. |
| `admincommands.fly` | deny | Toggle flight on a player. |
| `admincommands.mute` | deny | Stop a player using chat commands. |

All denied by default. Grant them to a group, and narrow them further with a
constraint when you want to — `allow = admincommands.give where item in
Money,PalSphere and count <= 1000` gives a junior moderator the command
without the run of the item list.

Set these without editing a file: drop your config on
**[Palladium Studio](https://s-kiu.github.io/Palladium/)** — it runs the agent's
own resolver in your browser, so what it shows is what your server will answer.
Nothing is uploaded.

## Settings

| Key | Default | What it means |
|---|---|---|
| `announce_slay` | `true` | Tell everyone when an admin slays somebody, so a death nobody caused in game is not a mystery. `false` keeps it between the admin and the victim. |

## Files

```
mods/AdminCommands/
├── mod.lua                   the mod — replaced when you update it
└── settings.example.config   shipped and commented; reference material

Mods/Palladium/mods/AdminCommands/
├── settings.config           yours — created from the example on the first load
│                             that finds none, never overwritten after; its
│                             [nodes] section holds your node defaults
├── .data                     who is muted, godded, frozen or flying
└── generated/commands.ref    what this mod added, written by the framework
```

## Install

Drop the folder into `./mods` — or your server's UE4SS `Mods` folder if you are
not running Pal-Up — and restart. Needs Palladium and nothing else.

## God mode, honestly

There is no single invincibility switch on this build that works. Two of them
look like one and are not: `IsImmortality` and the enemy damage-rate flag were
both verified written, and verified still set twenty-five seconds later, while
the player went on dying. Unreal's own `bCanBeDamaged` fared no better.

The reason is worth knowing, because it shapes everything here: **this game
simulates the player on the player's own machine.** Movement, stamina and the
damage you take are decided there and reported to the server. A flag the server
sets is not a flag the client reads.

What the server *does* own is corrections — a position the client accepts, a
health value it is told. So god mode is three things at once:

- **DefenseUp** raised to a million, so almost nothing gets through in the
  first place. This is what makes it feel like immunity rather than first aid.
- **Health and stomach refilled** on the agent's own tick, twice a second, as
  the backstop for whatever does get through.
- **Their real defence remembered**, and handed back by `!god @Name off`, so
  nobody is left permanently tougher than the game made them.

**Stamina is deliberately not touched.** The server's copy can be refilled and
verified full while the player's bar empties in front of them, because that bar
is drawn from the client's own simulation. Writing it changed nothing the
player could see and interfered with their regeneration, so the only correct
amount of it is none.

It is enforcement rather than prevention, and the difference is visible: a hit
big enough to kill between two ticks still kills. Freeze works the same way and
for the same reason — the player is put back where they stood rather than
prevented from leaving.

## What this mod does not do, and why

Two of the things an admin toolkit usually has cannot be done from inside the
game on this build. They are left out rather than stubbed, because a command
that quietly does nothing is worse than one that does not exist.

| Wanted | Why not |
|---|---|
| **mute** (real) | Palladium *observes* chat, it cannot cancel it: a message is already on its way to everyone by the time a mod sees it. `!mute` stops the player using commands, which is the part that is real — their words still reach the room |
| **kick / ban** | These live in the game's REST API. The panel reaches it; a mod running inside the game has no network, so it cannot. Kick and ban from the panel's **Players** page, or from `pal-up palapi` |

**Flight is a third case, and a different one.** It cannot be done from the
server either — flight is a mode the player's own game enters — but it *can* be
done with a mod on their machine, which is what
[AdminControlsClient](../../client/AdminControlsClient) is for. `!fly` sends the
instruction whether or not that mod is installed; without it, nothing happens.

If a future game build exposes any of the rest, the missing piece is a
capability in Palladium rather than a rewrite here — the mod would gain a
command and nothing else would change.

## Notes

- **Muting is remembered.** It lives in a collection, not in memory, so a
  restart does not quietly un-mute somebody.
- **Every write is audited.** A slay, a give, a teleport — each lands in
  `logs/bridge-audit.log` with who asked and what they asked for.
- **A muted admin is still muted.** `!mute` is checked before every command in
  this mod, including its own, so muting cannot be shrugged off by the person
  who was muted.
