# WelcomeKit

A first-ever join gets a private welcome and a starter kit, once. Returning
players get a greeting. Whether the kit is claimed is a tag on the player in
Palladium's own store, so "once ever" survives reinstalling this mod.

## Commands

| Command | Node | What it does |
|---|---|---|
| `!kit` | `welcomekit.kit` | Says whether your starter kit has been delivered. |

## Permission nodes

| Node | Default | Grants |
|---|---|---|
| `welcomekit.kit` | allow | Receive the starter kit on a first-ever join. |

Deny it to a group and its members get the greeting without the kit.

Set these without editing a file: drop your config on
**[Palladium Studio](https://s-kiu.github.io/Palladium/)** — it runs the agent's
own resolver in your browser, so what it shows is what your server will answer.
Nothing is uploaded.

## Settings

| Key | Default | What it means |
|---|---|---|
| `items.<n>.item` | `PalSphere`, `Pan` | Item id to hand over. Mentioning `items` replaces the whole kit, so list every item you want. |
| `items.<n>.count` | `10`, `5` | How many of it. |
| `announce` | `true` | Say hello in public chat as well as privately. |

Item ids are the game's internal names — bread is `Pan`, gold is `Money`.

## Files

```
mods/WelcomeKit/
├── mod.lua                   the mod — replaced when you update it
└── settings.example.config   shipped and commented; reference material

Mods/Palladium/mods/WelcomeKit/
├── settings.config           yours — created from the example on the first load
│                             that finds none, never overwritten after; its
│                             [nodes] section holds your node defaults
└── generated/commands.ref    what this mod added, written by the framework
```

## Install

Drop the folder into `./mods` — or your server's UE4SS `Mods` folder if you are
not running Pal-Up — and restart. Needs Palladium and nothing else.
