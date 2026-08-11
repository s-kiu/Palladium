# Permission studio

The one permissions-and-commands UI. A static page — no build step, no
backend, no request leaving it — that runs Palladium's real permission engine
under [fengari](https://github.com/fengari-lua/fengari-web) (vendored, MIT)
and answers from it. Operator documentation: [docs/studio.md](../../docs/studio.md).

It ships twice from this one folder:

- **GitHub Pages** — `.github/workflows/docs.yaml` publishes it at the site
  root; the mkdocs documentation builds one level down at `/docs`. Offline
  mode: files in, files out.
- **Panel image** — `packages/daemon/Dockerfile` copies it to `public/studio`,
  where the panel session turns it live. The panel's Permissions tab is an
  iframe of `/studio/index.html`.

The page probes `GET /api/session` (a public route) at its own origin to tell
the two apart; a static host 404s and the page stays offline. With
`?embed=panel` (how the panel's iframe loads it) the page drops its own
masthead and wears the panel's palette — the token values in `studio.css`
mirror `packages/panel/src/styles.css`.

## Layout

```
index.html / studio.js / studio.css   the page — hand-written, no framework
memfs.lua                             io/os over a table; fengari ships no io
boot.lua                              boots the engine, answers studio(request)
engine/                               GENERATED — verbatim engine copies plus
                                      manifest.js, from packages/shared/generate.mjs
vendor/fengari-web.js                 the Lua VM, vendored with its licence
test/harness.lua                      the same boot under plain Lua 5.4
```

Everything in `engine/` is written by the generator and drift-checked like
every other generated file — edit `mods/Palladium/Scripts/*` or the manifest,
then `node packages/shared/generate.mjs`.

## The two transports

`studio.js` routes every edit through one function. Offline (and in the live
page's sandbox), the request goes to the in-tab engine and the result is a
file to download. Live, the same edit is spelled as the capability that says
it — `group.set_entry`, `permission.grant`, … — via `POST /api/bridge/call`,
so the game stays the single writer of its own config; the studio then
re-fetches the file and re-boots the engine on it. Flipping a node's default
has no capability and uses `PUT /api/bridge/permissions-file`, the hand-edit
path a running server re-reads within seconds.

The simulator compiles a chat line by actually running it against the engine.
The compiled call feeds three things: the simulated outcome, the **Run on the
server** button (live), and the copyable `bridge-actions.jsonl` line
(offline).

## Testing

```
lua5.4 packages/studio/test/harness.lua
```

runs the shipped engine copies against the same boot the browser uses; what
passes there, fengari runs identically apart from the VM itself. Serve the page
locally with `python3 -m http.server 8437 --directory packages/studio`. One
fastify note: the daemon serves this folder through its
existing static registration — `wildcard: false` globs a route per file, and
adding explicit `/studio` routes duplicates them and fails the boot.
