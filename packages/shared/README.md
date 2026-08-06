# @pal-up/shared

One manifest and the catalogs, shared by everything that has to agree about
them.

- **`bridge-capabilities.json`** — every event, action and query: parameters,
  types, ranges, stability, and which runtime serves it. This is the source of
  truth. `generate.mjs` derives the agent's Lua capability table (hooks to
  register, parameter validation), the daemon's TypeScript table (validation,
  routing, schema) and [docs/bridge-reference.md](../../docs/bridge-reference.md)
  from it. CI runs the generator and fails if the tree differs, so a generated
  file can never drift from the manifest.
- **`game-data/`** — items, pal species and traits, behind
  `/api/bridge/catalog`. What makes the panel's pickers show *Gold Coin*
  rather than `Money`.

```bash
node packages/shared/generate.mjs      # after editing the manifest
```

Adding a capability is a manifest edit plus a handler in the agent; a game
patch that moves a hook is a manifest edit alone.
