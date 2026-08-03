// pal-up daemon — auth, game-server admin proxy, mods & backups API,
// and static hosting for the Angular panel.
//
// Design constraints:
//  - No docker.sock. Live admin goes through the game's REST API over the
//    compose network; everything else through the shared /palworld volume.
//  - Actions that need the game process down (restore, update) are written as
//    request markers into /palworld/.state; the game container's entrypoint
//    executes them on its next boot (a graceful REST shutdown triggers that
//    boot via the container restart policy).

import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));

// ── configuration ────────────────────────────────────────────────────────────
const PAL_ROOT = process.env.PAL_ROOT ?? '/palworld';
const STATE_DIR = path.join(PAL_ROOT, '.state');
const BACKUPS_DIR = path.join(PAL_ROOT, 'backups');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';
const GAME_HOST = process.env.PALWORLD_HOST ?? 'palworld';
const REST_PORT = Number(process.env.REST_API_PORT ?? 8212);
const PANEL_PORT = Number(process.env.PANEL_PORT ?? 3000);
const STEAM_APP_ID = process.env.STEAM_APP_ID ?? '2394010';
const GAME_PORT = Number(process.env.GAME_PORT ?? 8211);
const PUBLIC_PORT = Number(process.env.PUBLIC_PORT ?? GAME_PORT);
const PUBLIC_IP_ENV = process.env.PUBLIC_IP || null;
const PUBLIC_IP_LOOKUP = (process.env.PUBLIC_IP_LOOKUP ?? 'true') !== 'false';
const SERVER_LOG = path.join(PAL_ROOT, 'logs', 'server.log');
const FASTCRASH_LIMIT = Number(process.env.FASTCRASH_LIMIT ?? 3);
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_DAYS ?? 30) * 86_400_000;
const PUBLIC_DIR = process.env.PANEL_STATIC_DIR ?? path.join(HERE, '..', 'public');

if (!ADMIN_PASSWORD) {
  console.error('FATAL: ADMIN_PASSWORD is not set — the panel refuses to run without it.');
  process.exit(1);
}

// Session-cookie secret: explicit env var, else generated once and persisted
// on the shared volume so sessions survive panel restarts.
async function sessionSecret(): Promise<string> {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(STATE_DIR, 'panel-session-secret');
  try {
    return (await fs.readFile(file, 'utf8')).trim();
  } catch {
    const secret = randomBytes(32).toString('hex');
    await fs.mkdir(STATE_DIR, { recursive: true });
    await fs.writeFile(file, secret, { mode: 0o600 });
    return secret;
  }
}

// ── small helpers ────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readOpt(file: string): Promise<string | null> {
  try {
    return (await fs.readFile(file, 'utf8')).trim();
  } catch {
    return null;
  }
}

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(() => true, () => false);
}

function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  const len = Math.max(ba.length, bb.length, 1);
  const pa = Buffer.concat([ba], len);
  const pb = Buffer.concat([bb], len);
  return timingSafeEqual(pa, pb) && ba.length === bb.length;
}

const BACKUP_NAME_RE = /^palworld-\d{8}-\d{6}-[A-Za-z0-9_-]+\.tar\.gz$/;

function utcStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

// ── game REST API client ─────────────────────────────────────────────────────
async function pal(method: string, endpoint: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`http://${GAME_HOST}:${REST_PORT}/v1/api/${endpoint}`, {
    method,
    signal: AbortSignal.timeout(6000),
    headers: {
      authorization: 'Basic ' + Buffer.from(`admin:${ADMIN_PASSWORD}`).toString('base64'),
      accept: 'application/json',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`game api ${endpoint}: HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function palSafe(method: string, endpoint: string, body?: unknown): Promise<unknown | null> {
  try {
    return await pal(method, endpoint, body);
  } catch {
    return null;
  }
}

// ── volume readers ───────────────────────────────────────────────────────────
async function installedBuild(): Promise<string | null> {
  const acf = await readOpt(path.join(PAL_ROOT, 'server', 'steamapps', `appmanifest_${STEAM_APP_ID}.acf`));
  return acf?.match(/"buildid"\s+"(\d+)"/)?.[1] ?? null;
}

async function latestBuild(): Promise<{ id: string; checkedAt: number } | null> {
  const raw = await readOpt(path.join(STATE_DIR, 'remote-buildid'));
  const m = raw?.match(/^(\d+)\s+(\d+)$/);
  return m ? { checkedAt: Number(m[1]) * 1000, id: m[2] } : null;
}

async function fastcrashCount(): Promise<number> {
  // The counter is keyed to a (loader version, game build) pairing; a count
  // recorded for a different pairing is stale and must read as zero.
  const raw = await readOpt(path.join(STATE_DIR, 'ue4ss-fastcrash'));
  if (!raw) return 0;
  const [ctx, countStr] = raw.split('|');
  const version = ((await readOpt(path.join(STATE_DIR, 'ue4ss-version'))) ?? '').slice(0, 120);
  const build = (await installedBuild()) ?? '';
  if (ctx !== `${version}@${build}`) return 0;
  const n = Number(countStr);
  return Number.isFinite(n) ? n : 0;
}

interface ModEntry { name: string; enabled: boolean; user: boolean; disabledMarker: boolean }

async function luaMods(): Promise<ModEntry[]> {
  const userDir = path.join(PAL_ROOT, 'mods');
  const userNames = new Map<string, boolean>(); // name → has .disabled marker
  try {
    for (const e of await fs.readdir(userDir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        userNames.set(e.name, await exists(path.join(userDir, e.name, '.disabled')));
      }
    }
  } catch { /* mods dir may not exist yet */ }

  const entries: ModEntry[] = [];
  const seen = new Set<string>();
  const modsTxt = await readOpt(path.join(PAL_ROOT, 'server', 'Mods', 'mods.txt'));
  for (const line of modsTxt?.split('\n') ?? []) {
    const m = line.match(/^\s*([A-Za-z0-9][A-Za-z0-9_.-]*)\s*:\s*([01])/);
    if (!m) continue;
    seen.add(m[1]);
    entries.push({
      name: m[1],
      enabled: m[2] === '1',
      user: userNames.has(m[1]),
      disabledMarker: userNames.get(m[1]) ?? false,
    });
  }
  // user mods not yet synced into mods.txt (added since last restart)
  for (const [name, disabled] of userNames) {
    if (!seen.has(name)) {
      entries.push({ name, enabled: false, user: true, disabledMarker: disabled });
    }
  }
  return entries;
}

async function pakList(dir: string): Promise<{ name: string; sizeBytes: number }[]> {
  try {
    const out = [];
    for (const e of await fs.readdir(path.join(PAL_ROOT, dir), { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const st = await fs.stat(path.join(PAL_ROOT, dir, e.name));
      out.push({ name: e.name, sizeBytes: st.isDirectory() ? 0 : st.size });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

async function listBackups(): Promise<{ name: string; sizeBytes: number; mtime: number; tag: string }[]> {
  try {
    const out = [];
    for (const name of await fs.readdir(BACKUPS_DIR)) {
      if (!BACKUP_NAME_RE.test(name)) continue;
      const st = await fs.stat(path.join(BACKUPS_DIR, name));
      out.push({
        name,
        sizeBytes: st.size,
        mtime: st.mtimeMs,
        tag: name.replace(/^palworld-\d{8}-\d{6}-/, '').replace(/\.tar\.gz$/, ''),
      });
    }
    return out.sort((a, b) => b.name.localeCompare(a.name));
  } catch {
    return [];
  }
}

// ── app ──────────────────────────────────────────────────────────────────────
const app = Fastify({ logger: true, bodyLimit: 64 * 1024 });

await app.register(fastifyCookie, { secret: await sessionSecret() });
await app.register(fastifyStatic, { root: PUBLIC_DIR, wildcard: false });

const COOKIE = 'palup_session';

function setSession(reply: import('fastify').FastifyReply): void {
  reply.setCookie(COOKIE, String(Date.now() + SESSION_TTL_MS), {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

function sessionExpiry(req: import('fastify').FastifyRequest): number | null {
  const raw = req.cookies[COOKIE];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || unsigned.value === null) return null;
  const exp = Number(unsigned.value);
  return Number.isFinite(exp) && exp > Date.now() ? exp : null;
}

const PUBLIC_ROUTES = new Set(['/api/login', '/api/session', '/api/health']);

app.addHook('preHandler', async (req, reply) => {
  const route = req.url.split('?')[0];
  if (!route.startsWith('/api/') || PUBLIC_ROUTES.has(route)) return;
  const exp = sessionExpiry(req);
  if (exp === null) return reply.code(401).send({ error: 'unauthorized' });
  if (exp - Date.now() < SESSION_TTL_MS / 2) setSession(reply); // rolling renewal
});

// naive per-IP login throttle: 10 attempts/minute
const loginAttempts = new Map<string, { n: number; resetAt: number }>();

app.post<{ Body: { password?: string } }>('/api/login', async (req, reply) => {
  const now = Date.now();
  const slot = loginAttempts.get(req.ip) ?? { n: 0, resetAt: now + 60_000 };
  if (now > slot.resetAt) Object.assign(slot, { n: 0, resetAt: now + 60_000 });
  slot.n += 1;
  loginAttempts.set(req.ip, slot);
  if (slot.n > 10) return reply.code(429).send({ error: 'too many attempts — wait a minute' });

  if (!constantTimeEqual(req.body?.password ?? '', ADMIN_PASSWORD)) {
    return reply.code(401).send({ error: 'wrong password' });
  }
  setSession(reply);
  return { ok: true };
});

app.post('/api/logout', async (_req, reply) => {
  reply.clearCookie(COOKIE, { path: '/' });
  return { ok: true };
});

app.get('/api/session', async (req) => ({ authenticated: sessionExpiry(req) !== null }));
app.get('/api/health', async () => ({ ok: true }));

// ── status ───────────────────────────────────────────────────────────────────
app.get('/api/status', async () => {
  const [info, metrics, installed, latest, crashes, mods, logicmods, paks, backups] =
    await Promise.all([
      palSafe('GET', 'info'),
      palSafe('GET', 'metrics'),
      installedBuild(),
      latestBuild(),
      fastcrashCount(),
      luaMods(),
      pakList('logicmods'),
      pakList('paks'),
      listBackups(),
    ]);
  return {
    online: info !== null,
    info,
    metrics,
    build: {
      installed,
      latest: latest?.id ?? null,
      latestCheckedAt: latest?.checkedAt ?? null,
      updateAvailable: Boolean(installed && latest && latest.id !== installed),
      held: await exists(path.join(STATE_DIR, 'update-held')),
    },
    ue4ss: {
      vendored: await readOpt(path.join(STATE_DIR, 'ue4ss-version')),
      libInstalled: await exists(path.join(PAL_ROOT, 'server', 'libUE4SS.so')),
      fastcrashCount: crashes,
      fallbackActive: crashes >= FASTCRASH_LIMIT,
    },
    stopped: await exists(path.join(STATE_DIR, 'stop-request')),
    pending: {
      update: await exists(path.join(STATE_DIR, 'update-request')),
      restore: await readOpt(path.join(STATE_DIR, 'restore-request')),
      lastResult: await readOpt(path.join(STATE_DIR, 'last-request-result')),
    },
    counts: {
      luaMods: mods.filter((m) => m.user).length,
      bundledMods: mods.filter((m) => !m.user).length,
      logicMods: logicmods.length,
      paks: paks.length,
      backups: backups.length,
    },
  };
});

// ── players & admin ──────────────────────────────────────────────────────────
app.get('/api/players', async () => (await palSafe('GET', 'players')) ?? { players: [] });

// The game maintains the authoritative ban list on disk; the panel remembers
// names for bans it issued itself so the list stays human-readable.
const BANLIST_FILE = path.join(PAL_ROOT, 'saves', 'SaveGames', 'banlist.txt');
const PANEL_BANS_FILE = path.join(STATE_DIR, 'panel-bans.json');

async function readBanMeta(): Promise<Record<string, { name?: string; at?: number }>> {
  try {
    return JSON.parse((await readOpt(PANEL_BANS_FILE)) ?? '{}');
  } catch {
    return {};
  }
}

async function writeBanMeta(meta: Record<string, { name?: string; at?: number }>): Promise<void> {
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.writeFile(PANEL_BANS_FILE, JSON.stringify(meta, null, 2));
}

app.get('/api/bans', async () => {
  const raw = await readOpt(BANLIST_FILE);
  const meta = await readBanMeta();
  // banlist.txt lines are "steamid,playerUID" — the steam id is what the
  // REST unban endpoint and the panel metadata key on.
  const bans = (raw?.split('\n') ?? [])
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const userid = line.split(',')[0].trim();
      return {
        userid,
        name: meta[userid]?.name ?? null,
        bannedAt: meta[userid]?.at ?? null,
      };
    });
  return { bans };
});

app.post<{ Body: { userid?: string; message?: string } }>('/api/players/kick', async (req, reply) => {
  if (!req.body?.userid) return reply.code(400).send({ error: 'userid required' });
  await pal('POST', 'kick', { userid: req.body.userid, message: req.body.message ?? 'Kicked by admin' });
  return { ok: true };
});

app.post<{ Body: { userid?: string; message?: string; name?: string } }>(
  '/api/players/ban',
  async (req, reply) => {
    if (!req.body?.userid) return reply.code(400).send({ error: 'userid required' });
    await pal('POST', 'ban', { userid: req.body.userid, message: req.body.message ?? 'Banned by admin' });
    const meta = await readBanMeta();
    meta[req.body.userid] = { name: req.body.name, at: Date.now() };
    await writeBanMeta(meta);
    return { ok: true };
  },
);

app.post<{ Body: { userid?: string } }>('/api/players/unban', async (req, reply) => {
  if (!req.body?.userid) return reply.code(400).send({ error: 'userid required' });
  await pal('POST', 'unban', { userid: req.body.userid });
  const meta = await readBanMeta();
  delete meta[req.body.userid];
  await writeBanMeta(meta);
  return { ok: true };
});

app.post<{ Body: { message?: string } }>('/api/announce', async (req, reply) => {
  if (!req.body?.message) return reply.code(400).send({ error: 'message required' });
  await pal('POST', 'announce', { message: req.body.message });
  return { ok: true };
});

app.post('/api/save', async () => {
  await pal('POST', 'save');
  return { ok: true };
});

// ── mods ─────────────────────────────────────────────────────────────────────
app.get('/api/mods', async () => ({
  mods: await luaMods(),
  logicmods: await pakList('logicmods'),
  paks: await pakList('paks'),
}));

app.post<{ Body: { name?: string; disabled?: boolean } }>('/api/mods/toggle', async (req, reply) => {
  const name = req.body?.name ?? '';
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) return reply.code(400).send({ error: 'bad mod name' });
  const dir = path.join(PAL_ROOT, 'mods', name);
  if (!(await exists(dir))) return reply.code(404).send({ error: 'not a user mod' });
  const marker = path.join(dir, '.disabled');
  if (req.body?.disabled) await fs.writeFile(marker, '');
  else await fs.rm(marker, { force: true });
  return { ok: true, note: 'takes effect on next server restart' };
});

// ── backups ──────────────────────────────────────────────────────────────────
app.get('/api/backups', async () => ({ backups: await listBackups() }));

app.post('/api/backups', async (_req, reply) => {
  if (!(await exists(path.join(PAL_ROOT, 'saves', 'SaveGames')))) {
    return reply.code(409).send({ error: 'no world data yet' });
  }
  if ((await palSafe('POST', 'save')) !== null) await sleep(3000); // flush if live
  const name = `palworld-${utcStamp()}-panel.tar.gz`;
  const tmp = path.join(BACKUPS_DIR, `.${name}.part`);
  await fs.mkdir(BACKUPS_DIR, { recursive: true });
  await execFileP('tar', ['-czf', tmp, '-C', PAL_ROOT, 'saves']);
  await fs.rename(tmp, path.join(BACKUPS_DIR, name));
  return { ok: true, name };
});

app.post<{ Body: { name?: string } }>('/api/backups/restore', async (req, reply) => {
  const name = req.body?.name ?? '';
  if (name !== 'latest' && !BACKUP_NAME_RE.test(name)) {
    return reply.code(400).send({ error: 'bad backup name' });
  }
  if (name !== 'latest' && !(await exists(path.join(BACKUPS_DIR, name)))) {
    return reply.code(404).send({ error: 'backup not found' });
  }
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.writeFile(path.join(STATE_DIR, 'restore-request'), name);
  const online = (await palSafe('POST', 'shutdown', {
    waittime: 10,
    message: 'Restoring a world backup — back in ~2 minutes',
  })) !== null;
  return {
    ok: true,
    scheduled: true,
    note: online
      ? 'server is shutting down; the restore runs before it relaunches'
      : 'server appears offline; the restore runs on its next start',
  };
});

app.post('/api/update', async () => {
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.writeFile(path.join(STATE_DIR, 'update-request'), 'update');
  const online = (await palSafe('POST', 'shutdown', {
    waittime: 30,
    message: 'Server update — back in a few minutes',
  })) !== null;
  return {
    ok: true,
    scheduled: true,
    note: online
      ? 'server is shutting down; the update runs before it relaunches'
      : 'server appears offline; the update runs on its next start',
  };
});

// ── server lifecycle ─────────────────────────────────────────────────────────
// restart = graceful, container brings it back; stop = graceful + park marker
// (stays down until start); start = remove the marker; kill = immediate.
app.post<{ Body: { action?: string; waittime?: number; message?: string } }>(
  '/api/lifecycle',
  async (req, reply) => {
    const wait = Math.max(0, Number(req.body?.waittime ?? 30) || 0);
    const msg = req.body?.message;
    const stopMarker = path.join(STATE_DIR, 'stop-request');
    switch (req.body?.action) {
      case 'restart': {
        await palSafe('POST', 'save');
        const online =
          (await palSafe('POST', 'shutdown', {
            waittime: wait,
            message: msg || `Server restarting in ${wait}s`,
          })) !== null;
        return {
          ok: true,
          note: online
            ? `saving, then restarting in ${wait}s`
            : 'server was not running — it comes back on its own',
        };
      }
      case 'stop': {
        await fs.mkdir(STATE_DIR, { recursive: true });
        await fs.writeFile(stopMarker, new Date().toISOString());
        await palSafe('POST', 'save');
        const online =
          (await palSafe('POST', 'shutdown', {
            waittime: wait,
            message: msg || `Server shutting down in ${wait}s`,
          })) !== null;
        return {
          ok: true,
          note: online
            ? `saving, then stopping in ${wait}s — stays stopped until you press Start`
            : 'stop marker set — the server parks instead of launching',
        };
      }
      case 'start': {
        await fs.rm(stopMarker, { force: true });
        return { ok: true, note: 'starting — follow the console for progress' };
      }
      case 'kill': {
        await pal('POST', 'stop');
        return { ok: true, note: 'killed — the container restarts it now' };
      }
      default:
        return reply.code(400).send({ error: 'unknown action' });
    }
  },
);

// ── settings editor ──────────────────────────────────────────────────────────
// The panel edits a highest-precedence overrides file on the shared volume;
// the game container merges it into PalWorldSettings.ini on every boot, so
// changes apply on the next (graceful) restart.
const SETTINGS_MAP_PATH = process.env.SETTINGS_MAP_PATH ?? path.join(HERE, '..', 'settings.map');
const PANEL_SETTINGS_FILE = path.join(PAL_ROOT, 'config', 'panel-settings.env');
// Never editable from the panel: passwords (the admin password is the panel's
// own credential) and the REST surface the panel depends on.
const PROTECTED_KEYS = new Set(['AdminPassword', 'ServerPassword', 'RESTAPIEnabled', 'RESTAPIPort']);
const INI_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

type SettingType = 'str' | 'bool' | 'raw';
interface CatalogEntry {
  key: string;
  type: SettingType;
  group: string;
  envName: string;
  default: string | null;
  description: string;
}

async function settingsCatalog(): Promise<CatalogEntry[]> {
  const text = await readOpt(SETTINGS_MAP_PATH);
  const out: CatalogEntry[] = [];
  let group = 'Other';
  for (const line of text?.split('\n') ?? []) {
    const g = line.match(/^## (.+)$/);
    if (g) {
      group = g[1].trim();
      continue;
    }
    if (!line.trim() || line.startsWith('#')) continue;
    const [envName, key, type, def, description] = line.split('|');
    if (!envName || !key || !type) continue;
    if (PROTECTED_KEYS.has(key)) continue;
    out.push({
      key,
      type: (type as SettingType) ?? 'raw',
      group,
      envName,
      default: def === '-' ? null : (def ?? ''),
      description: description ?? '',
    });
  }
  return out;
}

function parseOverrides(text: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text?.split('\n') ?? []) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const key = line.slice(0, i);
    if (INI_KEY_RE.test(key)) out[key] = line.slice(i + 1);
  }
  return out;
}

function iniToDisplay(type: SettingType, v: string): string {
  if (type === 'str') return v.replace(/^"([\s\S]*)"$/, '$1').replace(/\\"/g, '"');
  if (type === 'bool') return /^true$/i.test(v) ? 'true' : 'false';
  return v;
}

function displayToIni(type: SettingType, v: string): string {
  const clean = String(v).replace(/[\r\n]/g, ' ').trim();
  if (type === 'bool') return /^(1|true|yes|on)$/i.test(clean) ? 'True' : 'False';
  if (type === 'str') return '"' + clean.replace(/"/g, '\\"') + '"';
  return clean;
}

function normalizeForCompare(type: SettingType, v: unknown): string {
  const s = String(v ?? '').trim();
  if (type === 'bool') return /^(1|true|yes|on)$/i.test(s) ? 'true' : 'false';
  const n = Number(s);
  if (s !== '' && Number.isFinite(n)) return String(n);
  return s;
}

async function settingsState() {
  const [catalog, overridesText, liveRaw] = await Promise.all([
    settingsCatalog(),
    readOpt(PANEL_SETTINGS_FILE),
    palSafe('GET', 'settings'),
  ]);
  const overrides = parseOverrides(overridesText);
  const live =
    liveRaw && typeof liveRaw === 'object' ? (liveRaw as Record<string, unknown>) : null;
  const catalogKeys = new Set(catalog.map((c) => c.key));

  const editable = catalog.map((c) => {
    const overridden = c.key in overrides;
    const envValue = process.env['OPT_' + c.key] ?? process.env[c.envName] ?? null;
    const value = overridden
      ? iniToDisplay(c.type, overrides[c.key])
      : (envValue ?? c.default ?? '');
    const source = overridden ? 'panel' : envValue !== null ? 'env' : 'default';
    const liveValue = live && c.key in live ? live[c.key] : null;
    const pending =
      overridden &&
      liveValue !== null &&
      normalizeForCompare(c.type, value) !== normalizeForCompare(c.type, liveValue);
    return { ...c, value, source, liveValue, overridden, pending };
  });

  const advanced = Object.entries(overrides)
    .filter(([k]) => !catalogKeys.has(k))
    .map(([key, value]) => ({ key, value }));

  return { online: live !== null, editable, advanced };
}

app.get('/api/settings-editor', async () => settingsState());

app.put<{ Body: { changes?: Record<string, string | null> } }>(
  '/api/settings-editor',
  async (req, reply) => {
    const changes = req.body?.changes ?? {};
    const catalog = await settingsCatalog();
    const types = new Map(catalog.map((c) => [c.key, c.type]));
    const overrides = parseOverrides(await readOpt(PANEL_SETTINGS_FILE));

    for (const [key, value] of Object.entries(changes)) {
      if (!INI_KEY_RE.test(key)) return reply.code(400).send({ error: `invalid key: ${key}` });
      if (PROTECTED_KEYS.has(key)) return reply.code(400).send({ error: `protected key: ${key}` });
      if (value === null) {
        delete overrides[key];
      } else {
        overrides[key] = displayToIni(types.get(key) ?? 'raw', String(value));
      }
    }

    const lines = ['# Managed by the pal-up panel — merged over .env settings on every boot.'];
    for (const [k, v] of Object.entries(overrides)) lines.push(`${k}=${v}`);
    await fs.mkdir(path.dirname(PANEL_SETTINGS_FILE), { recursive: true });
    await fs.writeFile(PANEL_SETTINGS_FILE, lines.join('\n') + '\n');
    return settingsState();
  },
);

// ── connect info ─────────────────────────────────────────────────────────────
let publicIpCache: { ip: string | null; at: number } = { ip: null, at: 0 };

async function publicIp(): Promise<string | null> {
  if (PUBLIC_IP_ENV) return PUBLIC_IP_ENV;
  if (!PUBLIC_IP_LOOKUP) return null;
  if (Date.now() - publicIpCache.at < 600_000) return publicIpCache.ip;
  try {
    const res = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(4000) });
    publicIpCache = { ip: (await res.text()).trim() || null, at: Date.now() };
  } catch {
    publicIpCache = { ip: null, at: Date.now() };
  }
  return publicIpCache.ip;
}

app.get('/api/connect', async () => ({
  online: (await palSafe('GET', 'info')) !== null,
  gamePort: GAME_PORT,
  publicPort: PUBLIC_PORT,
  publicIp: await publicIp(),
  publicIpConfigured: Boolean(PUBLIC_IP_ENV),
  lookupEnabled: PUBLIC_IP_LOOKUP,
}));

// ── server log tail ──────────────────────────────────────────────────────────
app.get<{ Querystring: { lines?: string } }>('/api/logs', async (req) => {
  const lines = Math.min(Math.max(Number(req.query.lines ?? 300) || 300, 10), 1000);
  try {
    const st = await fs.stat(SERVER_LOG);
    const readBytes = Math.min(st.size, 262_144);
    const fh = await fs.open(SERVER_LOG, 'r');
    try {
      const buf = Buffer.alloc(readBytes);
      await fh.read(buf, 0, readBytes, st.size - readBytes);
      const all = buf.toString('utf8').split('\n');
      if (st.size > readBytes) all.shift(); // drop a possibly-partial first line
      return { lines: all.slice(-lines - 1).filter((l, i, a) => l !== '' || i !== a.length - 1) };
    } finally {
      await fh.close();
    }
  } catch {
    return { lines: [] };
  }
});

// ── admin console: the full vanilla (REST) command surface ───────────────────
type ConsoleArgs = { message?: string; userid?: string; waittime?: number };
const CONSOLE_COMMANDS: Record<string, (a: ConsoleArgs) => Promise<unknown>> = {
  announce: (a) => pal('POST', 'announce', { message: a.message ?? '' }),
  save: () => pal('POST', 'save'),
  kick: (a) => pal('POST', 'kick', { userid: a.userid ?? '', message: a.message || 'Kicked by admin' }),
  ban: (a) => pal('POST', 'ban', { userid: a.userid ?? '', message: a.message || 'Banned by admin' }),
  unban: (a) => pal('POST', 'unban', { userid: a.userid ?? '' }),
  shutdown: (a) =>
    pal('POST', 'shutdown', {
      waittime: a.waittime ?? 30,
      message: a.message || 'Server restarting shortly',
    }),
  stop: () => pal('POST', 'stop'),
  info: () => pal('GET', 'info'),
  metrics: () => pal('GET', 'metrics'),
  settings: () => pal('GET', 'settings'),
};

app.post<{ Body: { command?: string; args?: ConsoleArgs } }>('/api/console', async (req, reply) => {
  const command = req.body?.command ?? '';
  const handler = CONSOLE_COMMANDS[command];
  if (!handler) return reply.code(400).send({ error: `unknown command: ${command}` });
  try {
    const result = await handler(req.body?.args ?? {});
    return { ok: true, result: result === '' ? 'OK' : result };
  } catch (err) {
    return reply.code(502).send({ error: (err as Error).message });
  }
});

// SPA fallback: any non-API GET serves the panel
app.setNotFoundHandler((req, reply) => {
  if (req.method === 'GET' && !req.url.startsWith('/api/')) {
    return reply.sendFile('index.html');
  }
  return reply.code(404).send({ error: 'not found' });
});

await app.listen({ host: '0.0.0.0', port: PANEL_PORT });
