# Game data catalogs

Static id → display-name tables served by the daemon at
`GET /api/bridge/catalog`, used by the panel's pickers. The game only accepts
internal ids (`Pan`, not "Bread"); these files are what makes them pickable.

- `items.json`, `pals.json` — datamined from the game's own tables; an id that
  disappears in a patch fails soft (the grant or spawn does nothing). Pal
  entries carry a `variant` derived from the id (normal/boss/raid/…) and a
  curated `element` list where known — null means unknown, which the picker
  exposes as its own filter. The daemon merges live observations on top:
  spawn-level ranges per species, and species missing from this table entirely
  (a mod's mobs) the moment one has spawned near a player.
- `traits.json` — passive-skill ids with display names, an effect summary and a
  tier used for colour-coding (4 legendary … 1 minor, negatives harmful).
  Curated from datamined community tables; `Legend`, `Rare` and
  `CraftSpeed_up1` are additionally confirmed present in the shipped build. An
  id the game does not know is ignored when applied, never an error.

Data files, not code: regenerating after a game update means re-exporting the
tables, not editing anything else.
