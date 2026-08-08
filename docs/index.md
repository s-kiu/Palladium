# Palladium & pal-up

**A modded Palworld dedicated server for Linux in one `docker compose up` —
and a modding API for building on top of it.**

Two halves of one project:

- **pal-up** — the server. Palworld's official mod system supports Windows
  dedicated servers only; pal-up brings server-side modding to Linux by
  integrating the native UE4SS port into a batteries-included container.
- **Palladium** — the modding framework, as one UE4SS Lua mod. A mod is one
  `mod.lua`: it declares its permissions, settings, data and chat commands,
  and Palladium does the rest — inside the game, with the same events and
  actions published to disk and over HTTP for everything outside it.

## Where to start

- **Running a server** → [Quickstart](quickstart.md)
- **Writing a mod** → [Writing mods](mods.md) — one file, no build step
- **Driving the server from outside** → [The bridge protocol](bridge.md)
- **Every event, action and chat command** → the
  [capability reference](bridge-reference.md), generated from one manifest
  so it can never drift from the code
- **Before exposing anything** → [Security](security.md)
- **When something is wrong** → [Troubleshooting](troubleshooting.md)

## The shipped mods

Read them before writing your own — each is one file:

- [GoldStreak](https://github.com/s-kiu/pal-up/tree/main/mods/GoldStreak) —
  gold on a respawn streak
- [WelcomeKit](https://github.com/s-kiu/pal-up/tree/main/mods/WelcomeKit) —
  a starter kit on a first-ever join, delivery-verified
- [TimedRewards](https://github.com/s-kiu/pal-up/tree/main/mods/TimedRewards)
  — rewards at the playtime hour marks the operator defines
- [Leaderboards](https://github.com/s-kiu/pal-up/tree/main/mods/Leaderboards)
  — who leads the server, refreshed on the clock's cadence

## Downloads

One always-current release per mod:
[github.com/s-kiu/pal-up/releases](https://github.com/s-kiu/pal-up/releases)
