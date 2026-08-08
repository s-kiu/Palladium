// A script mod: it runs beside the game rather than inside it, which is the
// whole point — UE4SS Lua has no sockets, so a mod that must reach the network
// cannot be a Lua mod. This one posts what happens in game to Discord.
//
// It is otherwise the same shape as a Lua mod: declare which events you want,
// read your settings, and answer. The panel starts it, restarts it if it
// falls over, and shows its log.

/**
 * @param {import('@pal-up/mod-sdk').Pal} pal
 * @param {string} text
 */
async function post(pal, text) {
  const webhook = pal.settings.webhook;

  // With no webhook configured the mod still runs and says what it would have
  // sent, so it can be installed and watched before any secret is handed over.
  if (!webhook) {
    console.log(`(no webhook set) would post: ${text}`);
    return;
  }

  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: text, username: pal.settings.username ?? 'Palworld' }),
  });

  // Discord answers 204 on success and 429 with a retry hint when we are too
  // chatty. Neither is worth crashing over: the next event will try again.
  if (res.status === 429) {
    const wait = Number(res.headers.get('retry-after') ?? 1);
    console.error(`rate limited, skipping this one (retry-after ${wait}s)`);
    return;
  }
  if (!res.ok) console.error(`discord refused it: HTTP ${res.status}`);
}

/** @param {import('@pal-up/mod-sdk').Pal} pal */
export async function start(pal) {
  const events = pal.settings.events ?? [];
  console.log(
    pal.settings.webhook
      ? `relaying ${events.join(', ')} to Discord`
      : `no webhook configured — relaying ${events.join(', ')} to this log instead`,
  );
}

/** @type {import('@pal-up/mod-sdk').ScriptMod['on']} */
export const on = {
  'player.join': async (event, pal) => {
    if (!(pal.settings.events ?? []).includes('player.join')) return;
    // firstEver arrives already decided, from a registry that outlives the
    // event file — no need to keep a list of who has been seen.
    const greeting = event.data.firstEver
      ? `**${event.subject.name}** joined for the first time`
      : `**${event.subject.name}** joined`;
    await post(pal, greeting);
  },

  'player.death': async (event, pal) => {
    if (!(pal.settings.events ?? []).includes('player.death')) return;
    const killer = event.data.killer;
    await post(
      pal,
      killer?.name
        ? `**${event.subject.name}** was killed by ${killer.name}`
        : `**${event.subject.name}** died`,
    );
  },

  'player.chat': async (event, pal) => {
    if (!(pal.settings.events ?? []).includes('player.chat')) return;
    // Chat is untrusted text: strip the markers Discord would act on, and
    // never let a player address the whole server through @everyone.
    const said = String(event.data.message ?? '')
      .replace(/[*_`~|]/g, '')
      .replace(/@(everyone|here)/gi, '@​$1')
      .slice(0, 300);
    if (said) await post(pal, `**${event.subject.name}**: ${said}`);
  },
};
