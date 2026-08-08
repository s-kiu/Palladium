# Examples

Three ways to build on a Palworld server, and a worked example of each. They
differ in one thing — where the code runs — and everything else follows from
that.

| | Runs | Needs | Reaches the network | Start here |
|---|---|---|---|---|
| **[Palladium mod](palladium)** | inside the game | Palladium | no | [mods/WelcomeKit](../mods/WelcomeKit) |
| **[Script mod](script)** | beside the game, started by the panel | Pal-Up | yes | [DiscordRelay](script/DiscordRelay) |
| **[External program](external)** | wherever you like | Pal-Up + an API token | yes | [death-feed.mjs](external/death-feed.mjs) |

**Write a Palladium mod by default.** It is one `mod.lua`, it reaches the
engine directly, it needs nothing running outside the game, and it works on a
server that has Palladium and nothing else.

**Write a script mod when it has to call out** — a Discord relay, anything
speaking HTTP to somebody else's API. This is the only reason to leave the
game process: UE4SS Lua has no sockets.

**Write an external program when it lives somewhere else entirely** — a bot on
another host, a dashboard, a CLI on your laptop. Same capabilities, reached
over HTTP with a token.

All three speak the same contract. A capability is called by the same name
with the same parameters whichever side you are on, because
[one manifest](../packages/shared/bridge-capabilities.json) generates the Lua
table, the TypeScript types and the
[reference](https://s-kiu.github.io/Palladium/bridge-reference/).

Guides: [writing mods](../docs/mods.md) · [the bridge protocol](../docs/bridge.md)
