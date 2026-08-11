# Palladium & Pal-Up

**Server-side Palworld modding on Linux — a framework, a server that ships
it, and one contract between them.**

Two products, one project. Pick your door:

- **"I want a modded server."** → **Pal-Up** — *Palladium, up.* Palworld's
  official mod system supports Windows dedicated servers only; Pal-Up brings
  server-side modding to Linux by integrating the native UE4SS port into a
  batteries-included container. Clone the repo, `docker compose up`, done —
  Palladium comes installed.
- **"I have a server — I want to build on it."** → **Palladium** — the
  modding framework, as one UE4SS Lua mod, released standalone for any UE4SS
  Palworld server. A mod is one `mod.lua`: it declares its permissions,
  settings, data and chat commands, and Palladium does the rest — inside the
  game, with the same events and actions published to disk and over HTTP for
  everything outside it.
- **"Both."** → Then everything connects: what the framework publishes, the
  panel renders, and what the panel can do, a mod or an external program can
  do too — both ends speak one generated contract.

## Where to start

- **Running a server** → [Quickstart](quickstart.md)
- **Writing a mod** → [Writing mods](mods.md) — one file, no build step
- **Driving the server from outside** → [The bridge protocol](bridge.md)
- **Every event, action and chat command** → the
  [capability reference](bridge-reference.md), generated from one manifest
  so it can never drift from the code
- **Who may do what on *your* server** → the
  [Palladium Studio](studio.md) — every command and who can use it, a
  per-player lens, a command simulator, editing with constraint help. It runs
  Palladium's own permission engine in the browser tab, so its answers cannot
  disagree with the game. Standalone against a downloaded
  `permissions.config` (nothing is uploaded anywhere), and live inside the
  Pal-Up panel, where edits apply immediately and commands really run
- **Before exposing anything** → [Security](security.md)
- **When something is wrong** → [Troubleshooting](troubleshooting.md)

## The shipped mods

Read them before writing your own — each is one file:

- [GoldStreak](https://github.com/s-kiu/Palladium/tree/main/examples/lua/GoldStreak) —
  gold on a respawn streak
- [WelcomeKit](https://github.com/s-kiu/Palladium/tree/main/examples/lua/WelcomeKit) —
  a starter kit on a first-ever join, delivery-verified
- [TimedRewards](https://github.com/s-kiu/Palladium/tree/main/examples/lua/TimedRewards)
  — rewards at the playtime hour marks the operator defines
- [Leaderboards](https://github.com/s-kiu/Palladium/tree/main/examples/lua/Leaderboards)
  — who leads the server, refreshed on the clock's cadence

## Downloads

One always-current release per mod:
[github.com/s-kiu/Palladium/releases](https://github.com/s-kiu/Palladium/releases)
