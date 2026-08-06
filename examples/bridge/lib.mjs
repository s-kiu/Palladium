// Minimal client for the pal-up bridge API. No dependencies — Node 22+ only.
//
//   PANEL_URL       default http://localhost:3000
//   PALUP_TOKEN     an API token from the panel's admin page (preferred)
//   ADMIN_PASSWORD  fallback: the panel password (cookie login)
//
// Every example in this folder is a plain consumer of the public HTTP API —
// nothing here the panel does not expose. The envelope is uniform: events and
// results are both {v, at, kind, type, subject, data}, so `follow()` yields and
// `call()` returns the same shape.

const PANEL = process.env.PANEL_URL ?? 'http://localhost:3000';

export class Bridge {
  #headers = {};

  async login({ token = process.env.PALUP_TOKEN, password = process.env.ADMIN_PASSWORD } = {}) {
    if (token) {
      this.#headers = { authorization: `Bearer ${token}` };
      return this;
    }
    if (!password) throw new Error('set PALUP_TOKEN (admin page → API tokens) or ADMIN_PASSWORD');
    const res = await fetch(`${PANEL}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) throw new Error(`login failed: HTTP ${res.status}`);
    const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
    if (!cookie) throw new Error('login succeeded but returned no session cookie');
    this.#headers = { cookie };
    return this;
  }

  async #call(path, init = {}) {
    const res = await fetch(`${PANEL}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), ...this.#headers },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${JSON.stringify(body)}`);
    return body;
  }

  schema() {
    return this.#call('/api/bridge/schema');
  }

  players() {
    return this.#call('/api/bridge/players');
  }

  // One verb for everything: call('player.give_item', id, {item, count}).
  // Returns the uniform result envelope; game-level failure is ok:false in the
  // envelope, not an exception.
  call(type, target, data = {}) {
    return this.#call('/api/bridge/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, target, data }),
    });
  }

  // Follows the event stream from wherever it is now, forever. `types` filters
  // server-side. A server reboot mid-stream yields a synthetic _restart event.
  async *follow({ from = 'end', intervalMs = 1000, types = null } = {}) {
    const typeParam = types?.length ? `&type=${types.join(',')}` : '';
    let cursor = 0;
    if (from === 'end') {
      for (;;) {
        const page = await this.#call(`/api/bridge/events?since=${cursor}&limit=500`);
        if (page.cursor === cursor) break;
        cursor = page.cursor;
      }
    }
    for (;;) {
      const page = await this.#call(`/api/bridge/events?since=${cursor}&limit=500${typeParam}`);
      if (page.cursor < cursor) {
        yield { v: 2, at: Math.floor(Date.now() / 1000), kind: 'event', type: '_restart', data: {} };
      }
      const advanced = page.cursor !== cursor;
      cursor = page.cursor;
      for (const event of page.events) yield event;
      if (!advanced) await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}

export async function connect(opts = {}) {
  const bridge = await new Bridge().login(opts);
  const schema = await bridge.schema();
  if (!schema.agent.ready) {
    throw new Error('the bridge agent is not loaded — check that mods/Palladium is enabled');
  }
  const live = schema.capabilities.filter((c) => c.kind === 'event' && c.live).map((c) => c.type);
  console.log(`connected: ${schema.agent.name} v${schema.agent.version} — live events: ${live.join(', ')}`);
  return bridge;
}
