# AdminCommands

Moderator commands in chat: teleport, give, slay, god, freeze, fly and mute. Every one is
gated by its own permission node, **all denied by default**, so installing this
mod hands nobody anything until you say so.

A Palladium mod: one `mod.lua`. No panel, no token, no process to run.

## Install

Drop the folder into `./mods` (or your server's UE4SS `Mods` folder if you are
not running Pal-Up) and restart the server.

```bash
cp -r "examples/palladium/AdminCommands" mods/
docker compose restart palworld
```

Then grant the nodes to the group that should have them, in
`mods/Palladium/permissions.config`:

```ini
[groups moderator]
allow = admincommands.tp
allow = admincommands.give
allow = admincommands.slay where target_weight < 12
```

That last line is worth knowing: a grant can be narrowed by Palladium itself,
so a moderator can slay players below their own rank and nobody at or above it.

## What appears in the folder

```
mods/AdminCommands/
├── mod.lua                      the mod itself
├── settings.example.config      shipped and commented; reference material
├── settings.config              yours — the slay announcement
├── permissions.example.config   shipped and commented
├── permissions.config           yours — the seven nodes and their defaults
├── admincommands.data           who is muted, godded, frozen or flying
└── (nothing else)
```

## Commands

Targets are written the way chat already writes them: `@Name` for an online
player, `@me` for yourself, and no target at all also means yourself. A name
nobody online carries is refused rather than guessed at.

| Command | Does |
|---|---|
| `!tp @Name` | Takes **you** to them |
| `!tp @Name @Other` | Sends the first player to the second |
| `!give @Name <item> [count]` | Hands over items. Ids are the game's own — gold is `Money`, bread is `Pan`. Answers only once the inventory agrees |
| `!slay @Name` | Kills them outright |
| `!god @Name` | Makes them unkillable. **Toggles** — run it again to undo |
| `!freeze @Name` | Holds them where they stand. Toggles. `@me` works — it stops movement, not chat |
| `!fly @Name` | Toggles flight. **Needs the [client mod](../../client/AdminControlsClient) installed on that player's game**, and is unverified even then |
| `!mute @Name` | Ignores their chat **commands**. Toggles |

Every switch above toggles: `!god @Name` turns it on, `!god @Name` again turns
it off. An explicit `on` or `off` still wins — `!god @Name off` — because a
script or a second admin should be able to say what it means rather than flip
whatever it finds. The state lives in this mod's own collections, so it
survives a restart and two admins see the same answer.

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
