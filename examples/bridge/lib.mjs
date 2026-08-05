// Minimal client for the pal-up bridge API. No dependencies — Node 18+ only.
//
//   PANEL_URL       default http://localhost:3000
//   ADMIN_PASSWORD  the same password the panel asks for
//
// Every example in this folder is a plain consumer of the public HTTP API: they
// use nothing the panel itself does not expose, so anything here can be
// rewritten in any language that can hold a cookie.

const PANEL = process.env.PANEL_URL ?? 'http://localhost:3000';

export class Bridge {
  #cookie = '';

  async login(password = process.env.ADMIN_PASSWORD) {
    if (!password) throw new Error('set ADMIN_PASSWORD (the panel password)');
    const res = await fetch(`${PANEL}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) throw new Error(`login failed: HTTP ${res.status}`);
    this.#cookie = (res.headers.getSetCookie?.() ?? [])
      .map((c) => c.split(';')[0])
      .join('; ');
    if (!this.#cookie) throw new Error('login succeeded but returned no session cookie');
    return this;
  }

  async #call(path, init = {}) {
    const res = await fetch(`${PANEL}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), cookie: this.#cookie },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(`${path}: HTTP ${res.status} ${JSON.stringify(body)}`);
    }
    return body;
  }

  status() {
    return this.#call('/api/bridge/status');
  }

  players() {
    return this.#call('/api/bridge/players');
  }

  action(action, params = {}) {
    return this.#call('/api/bridge/actions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...params }),
    });
  }

  announce(message) {
    return this.#call('/api/announce', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    });
  }

  // Follows the event stream from wherever it is now, forever. `cursor` is a
  // byte offset the server hands back; a cursor lower than the one sent means
  // the server rebooted and the stream restarted.
  async *follow({ from = 'end', intervalMs = 1000, types = null } = {}) {
    let cursor = 0;
    if (from === 'end') {
      const first = await this.#call('/api/bridge/events?since=0&limit=500');
      cursor = first.cursor;
      // Drain the rest of the backlog so we really start at the end.
      for (;;) {
        const more = await this.#call(`/api/bridge/events?since=${cursor}&limit=500`);
        if (more.cursor === cursor) break;
        cursor = more.cursor;
      }
    }
    for (;;) {
      const page = await this.#call(`/api/bridge/events?since=${cursor}&limit=500`);
      if (page.cursor < cursor) {
        yield { type: '_restart', at: Math.floor(Date.now() / 1000), v: 1 };
      }
      cursor = page.cursor;
      for (const event of page.events) {
        if (!types || types.includes(event.type)) yield event;
      }
      if (!page.events.length) await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}

export async function connect() {
  const bridge = await new Bridge().login();
  const status = await bridge.status();
  if (!status.available) {
    throw new Error('the bridge agent is not loaded — check that mods/PalBridgeAgent is enabled');
  }
  console.log(
    `connected: ${status.agent} v${status.version}, ` +
    `hooks live: ${status.hooks.filter((h) => h.ok).map((h) => h.hook).join(', ')}`,
  );
  return bridge;
}
