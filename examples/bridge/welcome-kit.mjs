// Scenario 1 — starter kit on first join.
//
// Watches for join events and hands first-time players a kit, with a private
// message explaining it. Returning players get a shorter greeting and nothing
// else, so the kit cannot be farmed by reconnecting.
//
//   ADMIN_PASSWORD=... node examples/bridge/welcome-kit.mjs
//
// The "have they been here before" question is answered by the player registry,
// which outlives server restarts — the event stream alone could not answer it.

import { connect } from './lib.mjs';

// Item ids are the game's internal names, which are not the names shown in
// game: bread is `Pan`, medical supplies are `Medicines`. A wrong id is not
// rejected — the grant simply does nothing — so check ids against a datamined
// item list rather than guessing them.
const KIT = [
  { item: 'PalSphere', count: 10 },
  { item: 'Pan', count: 5 },
];

const bridge = await connect();

// Anyone already in the registry has played here before, whatever this run says.
const seen = new Set((await bridge.players()).players.map((p) => p.userid));
console.log(`registry knows ${seen.size} player(s); watching for joins…`);

for await (const event of bridge.follow({ types: ['join'] })) {
  const { player, userid } = event;
  const returning = seen.has(userid);
  seen.add(userid);

  if (returning) {
    await bridge.action('message', { userid, text: `Welcome back, ${player}.` });
    console.log(`${player}: returning player, greeted`);
    continue;
  }

  await bridge.action('message', {
    userid,
    text: `Welcome to the server, ${player}! Here is a starter kit.`,
  });
  for (const { item, count } of KIT) {
    const result = await bridge.action('give_item', { userid, item, count });
    console.log(`${player}: ${item} x${count} → ${result.ok ? 'ok' : `FAILED (${result.detail})`}`);
  }
  await bridge.announce(`${player} just joined for the first time — say hi!`);
}
