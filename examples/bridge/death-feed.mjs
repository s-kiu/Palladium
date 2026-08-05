// Scenario 2 — a death feed, and the shape of a Discord relay.
//
// Formats every death into one line and keeps a running tally per player. With
// DISCORD_WEBHOOK set it posts the same line to a Discord channel; without it,
// it prints to stdout, which is what makes this runnable anywhere.
//
//   ADMIN_PASSWORD=... node examples/bridge/death-feed.mjs
//   ADMIN_PASSWORD=... DISCORD_WEBHOOK=https://... node examples/bridge/death-feed.mjs
//
// This is the read-only half of the bridge on its own: no actions, just the
// event stream turned into something a human wants to look at.

import { connect } from './lib.mjs';

const WEBHOOK = process.env.DISCORD_WEBHOOK;
const deaths = new Map();

async function post(text) {
  console.log(text);
  if (!WEBHOOK) return;
  await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: text }),
  }).catch((err) => console.error('webhook failed:', err.message));
}

const bridge = await connect();
console.log('watching for deaths…');

for await (const event of bridge.follow({ types: ['death', '_restart'] })) {
  if (event.type === '_restart') {
    await post('Server restarted — death counter continues.');
    continue;
  }
  const count = (deaths.get(event.userid) ?? 0) + 1;
  deaths.set(event.userid, count);

  const how = event.killer ? `was killed by **${event.killer}**` : 'died';
  const nth = count === 1 ? 'first death' : `death #${count}`;
  await post(`💀 **${event.player}** ${how} — ${nth} this session.`);
}
