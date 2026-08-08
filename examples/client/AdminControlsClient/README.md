# AdminControlsClient

The half of Palladium that runs on the **player's game**, not on the server.

Install this only if you want `!fly` to work. Everything else in this project —
teleport, give, slay, god, freeze, permissions, mods — is server-side and needs
nothing from your players.

## Why this exists

Palworld simulates the player on the player's own machine. Flight is a movement
mode the client enters; stamina is a bar the client draws. The server can set
its own copy of either and the player will never see the difference — that is
measured, not assumed: with a player godded, the server's stamina reads
100000/100000 while their bar empties in front of them.

So the dividing line across this whole project is who owns the value:

| Server owns it — works from the server alone | The client owns it — needs this mod |
|---|---|
| position (teleport, freeze), health, items, permissions, chat, spawns | flight, the stamina bar |

`!freeze` works because the server can put a player back where they stood.
There is no equivalent correction for "be flying", which is why flight needs
code on the machine that decides.

## How the server reaches it

Chat. It is the only channel a server already has to one specific player
without both sides sharing custom netcode. The agent sends a line nobody is
meant to read:

```
[[PAL:fly:on]]
```

This mod hooks `BroadcastChatMessage` on the game state — the NetMulticast that
actually delivers chat to a client — and acts on the line. It does **not** hide
it: blanking the message inside that multicast crashes the game, so the
instruction stays visible in chat. Odd-looking, harmless.

## Install (each player who wants flight)

1. Install [UE4SS](https://github.com/UE4SS-RE/RE-UE4SS/releases) into the
   **game** (not the server): the release zip goes beside
   `Palworld-Win64-Shipping.exe`, usually
   `steamapps/common/Palworld/Pal/Binaries/Win64/`.
2. Copy the `AdminControlsClient` folder into **`Pal/Binaries/Win64/ue4ss/Mods/`**.
   Note the `ue4ss/` — version 3 moved everything under it, and a mod dropped
   in the old `Win64/Mods/` is silently never loaded. If your install has no
   `ue4ss/` folder you are on version 2, where the old path is the right one.
3. Add `AdminControlsClient : 1` to that same folder's `mods.txt`.
4. On Linux, Steam launch options need
   `WINEDLLOVERRIDES="dwmapi=n,b" %command%` or Proton will not let UE4SS load
   at all.
5. Start the game. `ue4ss/UE4SS.log` says `loaded — waiting for instructions
   from the server` when it is working.

**The cheat manager matters.** UE4SS ships `CheatManagerEnablerMod` enabled by
default, and its log line `Enabled CheatManager` is what makes `ClientCheatFly`
work at all — without a cheat manager on the client, that call arrives and does
nothing. If flight fails, check that mod is on before suspecting this one.

Then an admin runs `!fly @You` on the server and you take off.

## Honestly: where this got to

The channel works. The server's instruction reaches the client, is parsed, and
is acted on — the log says so:

```
[AdminControlsClient] instruction: fly = on
[AdminControlsClient] flying via bCheatFlying + ClientCheatFly(pawn) + gravity + movement mode
```

**Flight itself does not.** All four switches apply and the player rises a few
centimetres and walks. Palworld's movement component overrides them in its own
per-frame update, and winning that argument means hooking that update rather
than setting flags around it — which is a different and much deeper piece of
work than this mod does.

So this is honest scaffolding rather than a finished feature:

- The **channel is proven** and is the useful part. Anything the client must do
  locally can travel this way; flight was only the first test case.
- The **flight attempt is left in**, logging each step it takes, because the
  next person to try needs to know which switches this build accepts. They all
  do, and it still is not enough.
- **Stamina is not attempted here.** It could be, on the same channel — the
  bar is client-drawn, so a client mod is the only thing that could refill it.
  It is left out rather than half-built.

One crash is worth recording: blanking the chat message inside the multicast
that carries it takes the game down. The payload belongs to the engine
mid-delivery. That is why the instruction stays visible in chat.

## Why it is not bundled into the server install

A server operator can install this project and never touch a player's machine.
The moment flight requires every player to install UE4SS themselves, it stops
being an admin feature and becomes a community agreement. Keeping it a separate,
optional folder makes that choice explicit rather than smuggling it into a
`docker compose up`.
