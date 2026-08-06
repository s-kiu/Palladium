// Runs one mod's script half. The daemon spawns this, never the mod file
// directly, so that connecting, waiting for the game server, filtering the
// stream and surviving a panel restart are written once here instead of once
// per mod.
//
// A mod exports what it needs and nothing else:
//
//   export async function start(pal) { … }            // once, after connecting
//   export const on = {                               // per event
//     'player.respawn': async (event, pal) => { … },
//   };
//
// A file that exports neither has already done its work at import time; the
// host says so and exits rather than idling in a way nobody asked for.

import { pathToFileURL } from 'node:url';
import { pal, sleep } from './index.mjs';

const NAME = process.env.PALUP_MOD_NAME ?? 'mod';
const ENTRY = process.env.PALUP_MOD_ENTRY;
if (!ENTRY) throw new Error('PALUP_MOD_ENTRY is not set');

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

// The panel is usually still booting, and the game server may be down for
// longer than that. Neither is this mod's problem to solve loudly. A rejected
// token is: it never becomes valid by waiting.
async function ready() {
  for (;;) {
    try {
      const schema = await pal.schema();
      if (!schema.agent.ready) throw new Error('the bridge agent is not loaded');
      return schema;
    } catch (err) {
      if (err.status === 401 || err.status === 403) throw err;
      console.error(`waiting: ${err.message}`);
      await sleep(5000);
    }
  }
}

const schema = await ready();
const mod = await import(pathToFileURL(ENTRY).href);

if (typeof mod.start === 'function') await mod.start(pal);

const handlers = mod.on ?? {};
const types = Object.keys(handlers);
if (types.length === 0) {
  if (typeof mod.start !== 'function') {
    console.log('nothing exported to run — no `on` handlers and no `start`');
  }
  process.exit(0);
}

// A handler for an event that does not exist would simply never fire, which is
// the worst way to learn about a typo. Engine hooks also move between game
// builds, so a type that exists but is not live is worth saying out loud.
const known = new Map((schema.capabilities ?? []).filter((c) => c.kind === 'event').map((c) => [c.type, c]));
for (const type of types) {
  const cap = known.get(type);
  if (!cap) console.error(`no such event: ${type} — this handler will never fire`);
  else if (cap.live === false) console.error(`${type} is not live on this build — this handler may never fire`);
}

console.log(`${NAME}: handling ${types.join(', ')}`);

for await (const event of pal.follow({ types })) {
  const handler = handlers[event.type];
  if (!handler) continue;
  // One event going wrong is not a reason to stop handling the next.
  try {
    await handler(event, pal);
  } catch (err) {
    console.error(`${event.type} (${event.subject?.name ?? 'no subject'}): ${err.message}`);
  }
}
