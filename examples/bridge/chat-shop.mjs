// Scenario 3 — chat commands added without touching the server.
//
// Adds !kit, !heal and !deaths as in-game commands. The panel's own router only
// knows !ping; everything here is an outside process reading the same stream and
// calling the same API, which is the whole argument for the bridge: a new
// command needs no mod change, no daemon change and no restart.
//
//   PALUP_TOKEN=palup_... node examples/bridge/chat-shop.mjs
//
// Chat is untrusted input. Commands are matched exactly, arguments are never
// interpreted, and each player is held to one command every few seconds.
//
// It also demonstrates the permission loop: on startup the script registers
// the nodes it owns (namespaced by its mod name), and every command checks its
// node before running. Operators manage who gets what on the panel's
// permissions page — deny "chatshop.kit" for the default group and grant it to
// a vip group, and this script needs no change.

import { connect } from './lib.mjs';

const COOLDOWN_MS = 5000;
const lastUsed = new Map();
const deaths = new Map();

const COMMANDS = {
  '!kit': {
    node: 'chatshop.kit',
    help: 'a handful of spheres and food',
    async run(bridge, { subject }) {
      for (const [item, count] of [['PalSphere', 5], ['Pan', 3]]) {
        const r = await bridge.call('player.give_item', subject.id, { item, count });
        if (!r.ok) return `could not hand out ${item}: ${r.error}`;
      }
      return `${subject.name}, your kit is in your inventory.`;
    },
  },
  '!heal': {
    node: 'chatshop.heal',
    help: 'full HP, plus a couple of medical supplies',
    async run(bridge, { subject }) {
      await bridge.call('player.heal', subject.id, {});
      const r = await bridge.call('player.give_item', subject.id, { item: 'Medicines', count: 2 });
      return r.ok ? 'Patched up.' : `no luck: ${r.error}`;
    },
  },
  '!gold': {
    help: 'how much gold you carry',
    async run(bridge, { subject }) {
      const r = await bridge.call('player.count_item', subject.id, { item: 'Money' });
      return r.ok ? `You carry ${r.data.count} gold.` : `could not check: ${r.error}`;
    },
  },
  '!deaths': {
    help: 'how many times you have died this session',
    async run(_bridge, { subject }) {
      const n = deaths.get(subject.id) ?? 0;
      return n === 0 ? 'You have not died yet. Bold.' : `You have died ${n} time(s).`;
    },
  },
};

const bridge = await connect();

// Idempotent — safe to run on every startup. default:"allow" is this mod's
// choice; operators override it per group or per player.
await bridge.call('permission.register', null, {
  mod: 'chatshop',
  nodes: [
    { node: 'chatshop.kit', description: 'use !kit for free supplies', default: 'allow' },
    { node: 'chatshop.heal', description: 'use !heal for a free heal', default: 'allow' },
  ],
});
console.log(`serving ${Object.keys(COMMANDS).join(' ')}`);

for await (const event of bridge.follow({ types: ['player.chat', 'player.death'] })) {
  const { subject } = event;
  if (event.type === 'player.death') {
    deaths.set(subject.id, (deaths.get(subject.id) ?? 0) + 1);
    continue;
  }

  const word = String(event.data.message ?? '').trim().split(/\s+/)[0].toLowerCase();
  const command = COMMANDS[word];
  if (!command) {
    if (word === '!help') {
      const list = Object.entries(COMMANDS).map(([k, v]) => `${k} — ${v.help}`).join(' | ');
      await bridge.call('player.message', subject.id, { text: list });
    }
    continue;
  }

  const now = Date.now();
  if (now - (lastUsed.get(subject.id) ?? 0) < COOLDOWN_MS) {
    await bridge.call('player.message', subject.id, { text: 'Slow down a moment.' });
    continue;
  }
  lastUsed.set(subject.id, now);

  if (command.node) {
    const perm = await bridge.call('permission.check', subject.id, { node: command.node });
    if (!perm.data.allowed) {
      await bridge.call('player.message', subject.id, { text: 'You are not allowed to use that.' });
      continue;
    }
  }

  console.log(`${subject.name} used ${word}`);
  const reply = await command.run(bridge, event);
  await bridge.call('player.message', subject.id, { text: reply });
}
