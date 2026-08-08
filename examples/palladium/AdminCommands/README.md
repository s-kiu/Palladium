# AdminCommands

Moderator commands in chat: teleport, give, slay, god and mute. Every one is
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
├── settings.config              yours — the god-mode ceiling, the slay
│                                announcement
├── permissions.example.config   shipped and commented
├── permissions.config           yours — the five nodes and their defaults
├── admincommands.data           who is muted, who is in god mode
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
| `!god @Name` / `!god @Name off` | Raises them out of reach, and puts them back |
| `!mute @Name` / `!mute @Name off` | Ignores their chat **commands** |

## God mode, honestly

This build exposes no invincibility flag, so there is nothing to switch on.
What this mod does instead is raise the player's maximum health to `god_hp`
(99,999,999 by default) and fill it — a ceiling nothing in the world reaches.

That is not the same thing, and the difference matters:

- Damage still lands. The number goes down; it just never runs out.
- Anything that kills regardless of health — should this build have such a
  thing — would still kill.
- The old maximum is stored in `admincommands.data` and handed back by
  `!god @Name off`. **If you delete that file while somebody is godded, their
  maximum health stays raised** and you will have to set it back by hand with
  `!player.set_stats @Name maxHp=<number>`.

## What this mod does not do, and why

Four of the things an admin toolkit usually has cannot be done from inside the
game on this build. They are left out rather than stubbed, because a command
that quietly does nothing is worse than one that does not exist.

| Wanted | Why not |
|---|---|
| **fly** | The engine exposes no flight toggle this build can reach. There is nothing to call |
| **freeze** | No movement lock either — no input-disable, no speed floor to pin to zero |
| **mute** (real) | Palladium *observes* chat, it cannot cancel it: a message is already on its way to everyone by the time a mod sees it. `!mute` stops the player using commands, which is the part that is real — their words still reach the room |
| **kick / ban** | These live in the game's REST API. The panel reaches it; a mod running inside the game has no network, so it cannot. Kick and ban from the panel's **Players** page, or from `pal-up palapi` |

If a future game build exposes any of them, the missing piece is a capability
in Palladium rather than a rewrite here — the mod would gain a command and
nothing else would change.

## Notes

- **Muting is remembered.** It lives in a collection, not in memory, so a
  restart does not quietly un-mute somebody.
- **Every write is audited.** A slay, a give, a teleport — each lands in
  `logs/bridge-audit.log` with who asked and what they asked for.
- **A muted admin is still muted.** `!mute` is checked before every command in
  this mod, including its own, so muting cannot be shrugged off by the person
  who was muted.
