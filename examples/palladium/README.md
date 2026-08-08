# Palladium mod examples

The worked examples of this kind are the mods that ship with the project, and
they live in [`../../mods`](../../mods) rather than here — because they are not
only examples. They are installed, loaded and running on any Pal-Up server from
the first `docker compose up`, and four of them are published for standalone
Palladium servers too. Moving them into an examples folder would mean a fresh
clone starts with nothing running.

Read them in this order — each is one file, and each adds one idea:

| Read | Teaches |
|---|---|
| **[WelcomeKit](WelcomeKit)** | The whole shape: an event handler, settings, a permission node, a tag that survives restarts — and giving items so that "did it arrive" is answered honestly |
| **[GoldStreak](GoldStreak)** | The smallest useful loop: count something per player with a tag, act every Nth time, and answer a chat command about it |
| **[TimedRewards](TimedRewards)** | Settlement rather than scheduling: pay every unpaid milestone at or below what a player has earned, so a restart owes nobody double. Also the first mod to keep its permission nodes in a [`permissions.config`](TimedRewards/permissions.example.config) instead of in `mod.lua` |
| **[Leaderboards](Leaderboards)** | Reacting to the clock: refresh standings on a cadence the operator sets, and answer `!lb` from what was already collected rather than hitting the engine on every command |

And one that is not a tutorial so much as a tool:
[AdminCommands](AdminCommands) — teleport, give, slay, god, freeze and mute as
chat commands, every one denied by default. It is the best example of a mod
that is mostly *arranging* capabilities rather than implementing anything.

## Writing your own

```bash
mkdir -p mods/CoolMod && $EDITOR mods/CoolMod/mod.lua
docker compose restart palworld
```

That is the whole install: a folder with a `mod.lua` in `./mods`, and a
restart. No build step, no token, no process to run. The full guide is
[docs/mods.md](../../docs/mods.md), and if you write Lua in an editor that
speaks [lua-language-server](https://luals.github.io), the repository is
already set up to complete `pal.` with the real capabilities.
