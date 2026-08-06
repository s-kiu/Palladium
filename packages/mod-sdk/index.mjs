// The client a mod's script half is handed. Nothing here is privileged: it is
// the same HTTP API in docs/bridge.md, with the envelope unwrapped and the
// mistakes that matter made hard to write.
//
// Two of those mistakes are worth naming. `give` reads the inventory back,
// because the engine accepts a grant of an unknown item id and silently adds
// nothing. `can` answers false when the check itself fails, because a
// permission question that could not be answered is not a yes.

const PANEL = process.env.PANEL_URL ?? 'http://localhost:3000';

export class Pal {
  #headers;
  #name;

  constructor({ token = process.env.PALUP_TOKEN, name = process.env.PALUP_MOD_NAME ?? 'mod' } = {}) {
    if (!token) throw new Error('no PALUP_TOKEN in the environment');
    this.#headers = { authorization: `Bearer ${token}` };
    this.#name = name;
    this.settings = JSON.parse(process.env.PALUP_MOD_SETTINGS ?? '{}');
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

  // null when the query did not answer — item counts are experimental, and a
  // build that cannot answer must not read as "carries none".
  async count(playerId, item) {
    const r = await this.call('player.count_item', playerId, { item });
    return r.ok ? r.data.count : null;
  }

  // True only once the inventory agrees. An unknown item id, or an inventory
  // with no room, both land here as false rather than as a cheerful lie.
  async give(playerId, item, count = 1) {
    const before = await this.count(playerId, item);
    const given = await this.call('player.give_item', playerId, { item, count });
    if (!given.ok) return false;
    const after = await this.count(playerId, item);
    if (before !== null && after !== null && after < before + count) return false;
    return true;
  }

  async message(playerId, text) {
    const r = await this.call('player.message', playerId, { text });
    return r.ok === true;
  }

  async announce(message) {
    const r = await this.call('server.announce', null, { message });
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
