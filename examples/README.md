# Examples

Three ways to build on a Palworld server, and a worked example of each. They
differ in one thing — where the code runs — and everything else follows from
that.

Each folder is named for what you need to run what is inside it, so the ladder
is the directory listing:

| Folder | Needs | Runs | Reaches the network |
|---|---|---|---|
| **[palladium](palladium)** | Palladium, on any UE4SS server | inside the game | no |
| **[palladium+pal-up](palladium+pal-up)** | Palladium **and** Pal-Up | beside the game, started by the panel | yes |
| **[palladium+pal-up+token](palladium+pal-up+token)** | Palladium, Pal-Up **and** an API token | wherever you like | yes |

Start with [WelcomeKit](palladium/WelcomeKit), then
[DiscordRelay](palladium+pal-up/DiscordRelay), then
[death-feed.mjs](palladium+pal-up+token/death-feed.mjs).

**Write a Palladium mod by default.** It is one `mod.lua`, it reaches the
engine directly, it needs nothing running outside the game, and it works on a
server that has Palladium and nothing else.

**Add Pal-Up when it has to call out** — a Discord relay, anything
speaking HTTP to somebody else's API. This is the only reason to leave the
game process: UE4SS Lua has no sockets.

**Add a token when it lives somewhere else entirely** — a bot on
another host, a dashboard, a CLI on your laptop. Same capabilities, reached
over HTTP with a token.

All three speak the same contract. A capability is called by the same name
with the same parameters whichever side you are on, because
[one manifest](../packages/shared/bridge-capabilities.json) generates the Lua
table, the TypeScript types and the
[reference](https://s-kiu.github.io/Palladium/bridge-reference/).

Guides: [writing mods](../docs/mods.md) · [the bridge protocol](../docs/bridge.md)
