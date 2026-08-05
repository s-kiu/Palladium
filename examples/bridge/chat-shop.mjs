// Scenario 3 — chat commands added without touching the server.
//
// Adds !kit, !heal and !deaths as in-game commands. The panel's own router only
// knows !ping; everything here is an outside process reading the same stream and
// calling the same API, which is the whole argument for the bridge: a new
// command needs no mod change, no daemon change and no restart.
//
//   ADMIN_PASSWORD=... node examples/bridge/chat-shop.mjs
//
// Chat is untrusted input. Commands are matched exactly, arguments are never
// interpreted, and each player is held to one command every few seconds.

import { connect } from './lib.mjs';

const COOLDOWN_MS = 5000;
const lastUsed = new Map();
const deaths = new Map();

const COMMANDS = {
  '!kit': {
    help: 'a handful of spheres and food',
    async run(bridge, { userid, player }) {
      for (const [item, count] of [['PalSphere', 5], ['Bread', 3]]) {
        const r = await bridge.action('give_item', { userid, item, count });
        if (!r.ok) return `could not hand out ${item}: ${r.detail}`;
      }
      return `${player}, your kit is in your inventory.`;
    },
  },
  '!heal': {
    help: 'a couple of medical supplies',
    async run(bridge, { userid }) {
      const r = await bridge.action('give_item', { userid, item: 'Medicine', count: 2 });
      return r.ok ? 'Medicine added to your inventory.' : `no luck: ${r.detail}`;
    },
  },
  '!deaths': {
    help: 'how many times you have died this session',
    async run(_bridge, { userid }) {
      const n = deaths.get(userid) ?? 0;
      return n === 0 ? 'You have not died yet. Bold.' : `You have died ${n} time(s).`;
    },
  },
};

const bridge = await connect();
console.log(`serving ${Object.keys(COMMANDS).join(' ')}`);

for await (const event of bridge.follow({ types: ['chat', 'death'] })) {
  if (event.type === 'death') {
    deaths.set(event.userid, (deaths.get(event.userid) ?? 0) + 1);
    continue;
  }

  const word = (event.message ?? '').trim().split(/\s+/)[0].toLowerCase();
  const command = COMMANDS[word];
  if (!command) {
    if (word === '!help') {
      const list = Object.entries(COMMANDS).map(([k, v]) => `${k} — ${v.help}`).join(' | ');
      await bridge.action('message', { userid: event.userid, text: list });
    }
    continue;
  }

  const now = Date.now();
  if (now - (lastUsed.get(event.userid) ?? 0) < COOLDOWN_MS) {
    await bridge.action('message', { userid: event.userid, text: 'Slow down a moment.' });
    continue;
  }
  lastUsed.set(event.userid, now);

  console.log(`${event.player} used ${word}`);
  const reply = await command.run(bridge, event);
  await bridge.action('message', { userid: event.userid, text: reply });
}
