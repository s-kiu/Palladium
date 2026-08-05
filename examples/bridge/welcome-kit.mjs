// Scenario 1 — starter kit on first join, exactly once, ever.
//
//   PALUP_TOKEN=palup_... node examples/bridge/welcome-kit.mjs
//
// Two server-side facts make this script five real lines: the join event
// arrives with `firstEver` already computed (the panel's database outlives
// reboots), and the kit-claimed flag is a tag on the player, so a crash between
// the give and the restart cannot hand out a second kit — and a second copy of
// this script cannot either.

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
console.log('watching for joins…');

for await (const event of bridge.follow({ types: ['player.join'] })) {
  const { subject, data } = event;

  if (!data.firstEver) {
    await bridge.call('player.message', subject.id, { text: `Welcome back, ${subject.name}.` });
    console.log(`${subject.name}: returning (join #${data.joins}), greeted`);
    continue;
  }

  const claimed = await bridge.call('player.get_tag', subject.id, { key: 'starter_kit' });
  if (claimed.data.value !== null) continue; // crashed mid-kit last time, half-given: stay safe

  await bridge.call('player.message', subject.id, {
    text: `Welcome to the server, ${subject.name}! Here is a starter kit.`,
  });
  let allOk = true;
  for (const { item, count } of KIT) {
    const r = await bridge.call('player.give_item', subject.id, { item, count });
    console.log(`${subject.name}: ${item} x${count} → ${r.ok ? 'ok' : `FAILED (${r.error})`}`);
    allOk &&= r.ok;
  }
  if (allOk) {
    await bridge.call('player.set_tag', subject.id, { key: 'starter_kit', value: String(Date.now()) });
    await bridge.call('server.announce', null, {
      message: `${subject.name} just joined for the first time — say hi!`,
    });
  }
}
