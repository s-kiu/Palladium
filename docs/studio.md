# Palladium Studio

Who may do what, answered by the engine that decides it. The studio runs
Palladium's own `permissions.lua`, `store.lua`, `collections.lua` and
`framework.lua` — verbatim, drift-checked copies — inside the browser tab, so
its answers cannot disagree with a server. Nothing you load is uploaded
anywhere; there is no backend to upload to.

**[Open the studio →](https://s-kiu.github.io/Palladium/)**

The same page runs in two modes and tells you which one you are in:

| | Standalone (this site, or any static copy) | Live (served by a Pal-Up panel at `/studio`) |
|---|---|---|
| Where the config comes from | You drop, paste or browse to it | Fetched from the server, automatically |
| Who answers questions | The engine in the tab | The engine in the tab, on the live file's bytes |
| How edits apply | Download the file, upload it back | Immediately, through the panel's audited capability door |
| Running commands | Simulated — plus a copyable action line | Real: a **Run on the server** button posts the call and shows the result |
| Who can use it | Anyone with the file | Anyone signed in to the panel |

## What is on it

Six tabs, and one status line above them saying what is loaded, whether it reads
clean, and where an edit goes. Each is a button that opens the detail; nothing
is expanded until something needs your attention.

| Tab | What it holds |
|---|---|
| **Overview** | Every mod, what it brought, and whether its folder is whole. A mod that would not load is here with the reason. |
| **Data** | What the mods have remembered — a read-only window on the store. |
| **Commands** | Every command, from mods and from Palladium alike, as a searchable list and a table with parameters. Pick one and it becomes a form; **Run** on a live server, **Show** for the same call written four ways. |
| **Permissions** | *Groups* — the node × group grid, group membership, and a search to get to the nodes you came for. *Players* — everyone the config names, their rank, their own overrides, and a simulator for trying a command as somebody. |
| **Settings** | Every mod's settings in one place, the author's default beside each. |
| **Agent** | Live server only: the event stream, the hooks the mod holds, who is connected, the pals loaded in the world, and how to reach all of it over HTTP with a token. |

Any box that offers suggestions takes a `?` to reach a list it would not offer
by itself: `?items`, `?pals`, `?traits` from the game data, and `?groups`,
`?players`, `?permissions` from the config you loaded.

## Standalone: a rented server and a file manager

This is the whole loop on a host where you cannot install Pal-Up:

1. Download `Mods/Palladium/mods/Palladium/permissions.config` with your provider's file
   manager. Windows line endings are fine — they are normalised on the way in.
2. Drop it on the studio. You get:
    - **Who may do what** — every node × every group, four states per cell:
      may, may on themselves (`@me`), may under a condition (`if` — hover or
      click for the exact rule), may not. Every mod that ever registered a
      node is in the file, so every mod appears without being asked for.
    - **One player** — pick anyone the config names, a simulated player, or
      paste an id: their overrides, groups by weight, standing, and every node
      with the deciding entry spelled out. Dated grants show their dates.
    - **Health** — the same parse warnings the server would log, line numbers
      included, instead of a silent misread.
3. Edit — click a cell, pick allow/deny/inherit, add a constraint (the dialog
   lists which fields that call actually carries, and explains the grammar),
   set an `until` date from the picker.
4. Download and upload it back. Only the files you actually changed are
   written, so a permission edit does not hand you every mod's settings to
   copy back. A running server re-reads within seconds; no restart.

**Mod folders load too.** Drop a mod's folder (or its `mod.lua`) alongside the
config and it loads exactly as a server loads it: its commands dispatch in the
simulator, its permission nodes register, a broken one is refused with the
same error the server would log. Mods run against a stub engine — no world, no
pals, empty storage — so permission gating, argument parsing and chat replies
are real, while world-reading commands answer emptily.

**Running a command without a panel.** The simulator compiles a chat line into
the same action the panel would enqueue. When a simulated command executes,
the studio offers the exact line — `action=… id=… userid=… key=value…` — ready
to append to `.state/bridge-actions.jsonl` on the shared volume (standalone
servers keep it in the `palladium/` folder beside `ue4ss/`). The game answers
in `logs/bridge-events.jsonl` under the same id. Anyone who can write that
file already owns the server; this adds convenience, not access.

## Live: inside the Pal-Up panel

The panel's **Palladium** tab is the studio, served from the same origin, so
your panel session makes it live — there is nothing separate to sign in to.
Opening `/studio` directly works the same way.

- The server's real `permissions.config` loads on open. Questions are still
  answered by the engine in the tab, on those bytes: instant, no load on the
  game, and provably the same answers the game would give.
- Edits go through `POST /api/bridge/call` — `group.set_entry`,
  `permission.grant` and friends — so **the game remains the single writer of
  its own file** and every change lands in the audit log like any other panel
  or token write. The one exception is flipping a node's default, which has no
  capability: the studio writes the file the way a hand edit would, and the
  server re-reads it within seconds.
- The lens offers players who are **online right now**, next to everyone the
  config names.
- **Run on the server** appears under a successful simulation and posts the
  real call, result envelope and all.
- Loading any file by hand while connected switches to a clearly-bannered
  **sandbox**: a local what-if copy, the live server untouched, one click to
  return.

## What it will not do

- Standalone mode cannot execute anything — on a bare server there is nothing
  listening; the action-line loop above is the honest substitute.
- The page states which Palladium version it speaks. A config from another
  version loads, and unknown nodes are listed as they are rather than guessed
  at.
- Rewriting the file drops hand-written comments — true of every write path,
  panel and mod included, and the file's own header says so.
