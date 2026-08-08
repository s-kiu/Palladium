// The client a mod's script half is handed. Nothing here is privileged: it is
// the same HTTP API in docs/bridge.md, with the envelope unwrapped and the
// mistakes that matter made hard to write.
//
// Every capability hangs off this object under the name the manifest gives it
// — `pal.player.give_item(id, { item, count })` is the same call as
// `!give_item` in chat, `player.give_item` over HTTP and `pal.player.give_item`
// in a Lua mod. The tree is built from the generated list, so a name cannot
// mean one thing here and another there, and a verb that is not a capability
// throws rather than making a pointless round trip.
//
// `can` is the one deliberate exception: it answers false when the check
// itself fails, because a permission question that could not be answered is
// not a yes.

import { capabilities } from './generated/capabilities.mjs';

const PANEL = process.env.PANEL_URL ?? 'http://localhost:3000';

const NAMESPACES = new Map();
for (const [type, spec] of Object.entries(capabilities)) {
  const [ns, verb] = type.split('.');
  if (!NAMESPACES.has(ns)) NAMESPACES.set(ns, new Map());
  NAMESPACES.get(ns).set(verb, { type, ...spec });
}

export class Pal {
  #headers;
  #name;

  constructor({ token = process.env.PALUP_TOKEN, name = process.env.PALUP_MOD_NAME ?? 'mod' } = {}) {
    if (!token) throw new Error('no PALUP_TOKEN in the environment');
    this.#headers = { authorization: `Bearer ${token}` };
    this.#name = name;
    this.settings = JSON.parse(process.env.PALUP_MOD_SETTINGS ?? '{}');

    // An id comes first when the call names someone and is left out when it
    // does not — pal.server.announce({ message }). Read from the arguments
    // rather than the manifest's target field, since a call may target the
    // world or the server and still take no id.
    for (const [ns, verbs] of NAMESPACES) {
      const group = {};
      for (const [verb, spec] of verbs) {
        group[verb] = (a, b) =>
          typeof a === 'object' && a !== null
            ? this.call(spec.type, null, a)
            : this.call(spec.type, a ?? null, b ?? {});
      }
      this[ns] = Object.freeze(group);
    }
  }

  get name() {
    return this.#name;
  }

  async api(path, init = {}) {
    const res = await fetch(`${PANEL}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), ...this.#headers },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(`${path}: HTTP ${res.status} ${JSON.stringify(body)}`);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  // The raw verb. A failure in the game is ok:false inside the returned
  // envelope, never an exception — only protocol errors throw.
  call(type, target, data = {}) {
    return this.api('/api/bridge/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, target, data }),
    });
  }

  schema() {
    return this.api('/api/bridge/schema');
  }

  players() {
    return this.api('/api/bridge/players');
  }

  // ── the everyday half ──────────────────────────────────────────────────────

  async can(playerId, node) {
    const r = await this.call('permission.check', playerId, { node });
    return r.ok === true && r.data.allowed === true;
  }

  async tag(playerId, key) {
    const r = await this.call('player.get_tag', playerId, { key });
    if (!r.ok) throw new Error(`could not read tag ${key}: ${r.error}`);
    return r.data.value;
  }

  async setTag(playerId, key, value) {
    const r = await this.call('player.set_tag', playerId, { key, value: String(value) });
    return r.ok === true;
  }

  async deleteTag(playerId, key) {
    const r = await this.call('player.delete_tag', playerId, { key });
    return r.ok === true;
  }

  // ── moved, and saying so once ──────────────────────────────────────────────
  // These were capabilities under invented names. The read-back `give` used to
  // do itself now lives in player.give_item, so every surface — chat, HTTP, a
  // Lua mod, this one — learns whether the items actually arrived.

  #warn(old, replacement) {
    Pal.#warned ??= new Set();
    if (Pal.#warned.has(old)) return;
    Pal.#warned.add(old);
    console.error(`pal.${old}() is deprecated — use pal.${replacement}() (the manifest's name)`);
  }
  static #warned;

  async count(playerId, item) {
    this.#warn('count', 'player.count_item');
    const r = await this.player.count_item(playerId, { item });
    return r.ok ? r.data.count : null;
  }

  async give(playerId, item, count = 1) {
    this.#warn('give', 'player.give_item');
    const r = await this.player.give_item(playerId, { item, count });
    return r.ok === true;
  }

  async message(playerId, text) {
    this.#warn('message', 'player.message');
    const r = await this.player.message(playerId, { text });
    return r.ok === true;
  }

  async announce(message) {
    this.#warn('announce', 'server.announce');
    const r = await this.server.announce({ message });
    return r.ok === true;
  }

  // ── events ─────────────────────────────────────────────────────────────────

  // Follows from wherever the stream is now, forever. A game server reboot
  // empties the event file; the cursor rewinds on its own and the next run's
  // events arrive as normal, so there is nothing to reset here.
  async *follow({ types = null, intervalMs = 1000, retryMs = 5000 } = {}) {
    const filter = types?.length ? `&type=${types.join(',')}` : '';
    let cursor = 0;
    for (;;) {
      const page = await this.api(`/api/bridge/events?since=${cursor}&limit=500`);
      if (page.cursor === cursor) break;
      cursor = page.cursor;
    }
    for (;;) {
      let page;
      try {
        page = await this.api(`/api/bridge/events?since=${cursor}&limit=500${filter}`);
      } catch (err) {
        if (err.status === 401 || err.status === 403) throw err;
        console.error(`event stream unavailable, retrying: ${err.message}`);
        await sleep(retryMs);
        continue;
      }
      const advanced = page.cursor !== cursor;
      cursor = page.cursor;
      for (const event of page.events) yield event;
      if (!advanced) await sleep(intervalMs);
    }
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The instance the host hands to handlers.
export const pal = process.env.PALUP_TOKEN ? new Pal() : null;
