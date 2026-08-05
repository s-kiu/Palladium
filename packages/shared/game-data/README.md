# Game data catalogs

Static id → display-name tables served by the daemon at
`GET /api/bridge/catalog`, used by the panel's pickers. The game only accepts
internal ids (`Pan`, not "Bread"); these files are what makes them pickable.

- `items.json`, `pals.json` — datamined from the game's own tables; an id that
  disappears in a patch fails soft (the grant or spawn does nothing).
- `traits.json` — passive-skill ids with display names, an effect summary and a
  tier used for colour-coding (4 legendary … 1 minor, negatives harmful).
  Curated from datamined community tables; `Legend`, `Rare` and
  `CraftSpeed_up1` are additionally confirmed present in the shipped build. An
  id the game does not know is ignored when applied, never an error.

Data files, not code: regenerating after a game update means re-exporting the
tables, not editing anything else.
