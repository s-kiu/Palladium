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
  // mods present in the folder but absent from mods.txt until the next restart
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

// ── resource usage ───────────────────────────────────────────────────────────
// Host memory/CPU from /proc (visible host-wide inside the container); game
// process CPU/RSS from the sampler the game container writes onto the volume.
let prevHostCpu: { total: number; idle: number } | null = null;

async function hostResources() {
  const mem = await readOpt('/proc/meminfo');
  const memTotalKb = Number(mem?.match(/^MemTotal:\s+(\d+)/m)?.[1] ?? 0);
  const memAvailKb = Number(mem?.match(/^MemAvailable:\s+(\d+)/m)?.[1] ?? 0);
  let cpuPercent: number | null = null;
  const stat = await readOpt('/proc/stat');
  const parts = stat?.split('\n')[0]?.trim().split(/\s+/).slice(1).map(Number) ?? [];
  if (parts.length >= 5) {
    const idle = parts[3] + (parts[4] ?? 0);
    const total = parts.reduce((a, b) => a + b, 0);
    if (prevHostCpu && total > prevHostCpu.total) {
      cpuPercent = Math.round(100 * (1 - (idle - prevHostCpu.idle) / (total - prevHostCpu.total)));
    }
    prevHostCpu = { total, idle };
  }
  return {
    memTotalMb: Math.round(memTotalKb / 1024),
    memUsedMb: Math.round((memTotalKb - memAvailKb) / 1024),
    cpuPercent,
  };
}

async function gameResources() {
  try {
    const j = JSON.parse((await readOpt(path.join(STATE_DIR, 'game-stats.json'))) ?? 'null');
    if (!j || j.running === false || Date.now() / 1000 - j.at > 60) return null;
    return {
      rssMb: Math.round((j.rssKb ?? 0) / 1024),
      cpuPercent: typeof j.cpuPercent === 'number' ? j.cpuPercent : null,
    };
  } catch {
    return null;
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
  const online = info !== null;
  const stopped = await exists(path.join(STATE_DIR, 'stop-request'));
  return {
    online,
    info,
    metrics,
    operation: operationView(online, stopped),
    resources: { host: await hostResources(), game: await gameResources() },
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
    stopped,
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
  await panelLog('world save requested');
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
  await panelLog(`backup created: ${name}`);
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
  await panelLog(`restore scheduled: ${name}`);
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
  await panelLog('game update scheduled');
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

// ── pending operation & panel audit log ──────────────────────────────────────
// Admin actions append to the on-volume server log (visible in the panel's
// log viewer alongside game output) and register a pending operation so the
// UI can show a live countdown and completion.
interface PendingOp {
  kind: 'restart' | 'stop' | 'kill';
  message?: string;
  scheduledAt: number;
  fireAt: number;
}
let pendingOp: PendingOp | null = null;

async function panelLog(text: string): Promise<void> {
  const ts = new Date().toISOString().slice(11, 19);
  await fs.appendFile(SERVER_LOG, `[panel] ${ts} | ${text}\n`).catch(() => {});
}

function operationView(online: boolean, stopped: boolean) {
  if (!pendingOp) return null;
  const now = Date.now();
  // stale-op safety net: never show an operation older than 10 minutes
  if (now > pendingOp.fireAt + 600_000) {
    pendingOp = null;
    return null;
  }
  if (now < pendingOp.fireAt) {
    return { ...pendingOp, phase: 'countdown' as const };
  }
  const settled =
    pendingOp.kind === 'stop'
      ? stopped && !online
      : online && now > pendingOp.fireAt + 15_000;
  if (settled) {
    pendingOp = null;
    return null;
  }
  return { ...pendingOp, phase: 'executing' as const };
}

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
        if (online) {
          pendingOp = { kind: 'restart', message: msg, scheduledAt: Date.now(), fireAt: Date.now() + wait * 1000 };
          await panelLog(`restart scheduled — ${wait}s warning${msg ? ` — "${msg}"` : ''}`);
        }
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
        pendingOp = {
          kind: 'stop',
          message: msg,
          scheduledAt: Date.now(),
          fireAt: Date.now() + (online ? wait * 1000 : 0),
        };
        await panelLog(
          online
            ? `stop scheduled — ${wait}s warning${msg ? ` — "${msg}"` : ''} — stays stopped until Start`
            : 'stop marker set — the server parks instead of launching',
        );
        return {
          ok: true,
          note: online
            ? `saving, then stopping in ${wait}s — stays stopped until you press Start`
            : 'stop marker set — the server parks instead of launching',
        };
      }
      case 'start': {
        await fs.rm(stopMarker, { force: true });
        pendingOp = null;
        await panelLog('start requested');
        return { ok: true, note: 'starting — follow the console for progress' };
      }
      case 'kill': {
        await pal('POST', 'stop');
        pendingOp = { kind: 'kill', scheduledAt: Date.now(), fireAt: Date.now() };
        await panelLog('force kill sent — no save, container restarts the server');
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
    await panelLog(`settings saved: ${Object.keys(changes).length} change(s) — apply on next restart`);
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
// ── in-game event bridge ─────────────────────────────────────────────────────
// UE4SS Lua has no sockets, so the in-game agent talks to the rest of the world
// through two files on the shared volume: it appends events to one and reads
// action requests from the other. The daemon is the public face of both.
//
// Cursors are byte offsets. The game container empties both files at boot, so a
// cursor is only meaningful within one server run; a cursor past the end of the
// file means the run ended and the reader rewinds to the start.
const BRIDGE_EVENTS = path.join(PAL_ROOT, 'logs', 'bridge-events.jsonl');
const BRIDGE_ACTIONS = path.join(STATE_DIR, 'bridge-actions.jsonl');
const BRIDGE_PLAYERS = path.join(STATE_DIR, 'bridge-players.json');
const BRIDGE_WINDOW = 262_144; // bytes served per request, caps response size
const ACTION_TIMEOUT_MS = 6000;
const ACTION_KEY_RE = /^[A-Za-z0-9_]+$/;

interface BridgeEvent {
  v: number;
  at: number;
  type: string;
  player?: string;
  userid?: string;
  message?: string;
  [key: string]: unknown;
}

async function readBridge(
  since: number,
  limit: number,
): Promise<{ events: BridgeEvent[]; cursor: number }> {
  let size: number;
  try {
    size = (await fs.stat(BRIDGE_EVENTS)).size;
  } catch {
    return { events: [], cursor: 0 }; // no agent installed, or not booted yet
  }
  const from = Number.isFinite(since) && since >= 0 && since <= size ? since : 0;
  const want = Math.min(size - from, BRIDGE_WINDOW);
  if (want <= 0) return { events: [], cursor: from };

  const fh = await fs.open(BRIDGE_EVENTS, 'r');
  let buf: Buffer;
  try {
    buf = Buffer.alloc(want);
    const { bytesRead } = await fh.read(buf, 0, want, from);
    buf = buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }

  const events: BridgeEvent[] = [];
  let cursor = from;
  let idx = 0;
  while (events.length < limit) {
    const nl = buf.indexOf(0x0a, idx);
    if (nl === -1) break; // trailing partial line: leave it for the next read
    const line = buf.subarray(idx, nl).toString('utf8').trim();
    idx = nl + 1;
    cursor = from + idx;
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      // Advance past anything unrecognised rather than stalling on it: one
      // torn line must not wedge the stream for every reader behind it.
      if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') {
        events.push(parsed as BridgeEvent);
      }
    } catch { /* malformed line — skipped, cursor already moved past it */ }
  }
  // A full window with no line break at all can only be corruption; skip it so
  // the cursor cannot get stuck.
  if (idx === 0 && buf.length === BRIDGE_WINDOW) cursor = from + buf.length;
  return { events, cursor };
}

// ── what the agent says about itself ─────────────────────────────────────────
// The agent announces its version and every hook it managed to register, so the
// panel shows what is actually live rather than a list compiled here that would
// drift the moment a game patch moves an engine function.
interface HookState { hook: string; target: string; ok: boolean }

interface BridgeRun {
  agent: string | null;
  version: string | null;
  schema: number | null;
  actions: string[];
  hooks: HookState[];
  types: string[];
  lastEventAt: number;
}

function emptyRun(): BridgeRun {
  return { agent: null, version: null, schema: null, actions: [], hooks: [], types: [], lastEventAt: 0 };
}

let bridgeRun = emptyRun();

// ── player registry ──────────────────────────────────────────────────────────
// Every id the bridge has ever seen, kept across reboots. The event file starts
// empty each run, so this file is the only place a first-seen date can live.
interface PlayerRecord {
  userid: string;
  name: string;
  firstSeen: number;
  lastSeen: number;
  joins: number;
  online: boolean;
}

const playerRegistry = new Map<string, PlayerRecord>();
let registryDirty = false;

async function loadRegistry(): Promise<void> {
  try {
    const raw = JSON.parse((await readOpt(BRIDGE_PLAYERS)) ?? '{}');
    for (const [userid, rec] of Object.entries(raw as Record<string, PlayerRecord>)) {
      // Online is a property of a running server, never of the saved file.
      playerRegistry.set(userid, { ...rec, userid, online: false });
    }
  } catch { /* first run, or a file we cannot parse — start empty */ }
}

async function flushRegistry(): Promise<void> {
  if (!registryDirty) return;
  registryDirty = false;
  const out: Record<string, PlayerRecord> = {};
  for (const [userid, rec] of playerRegistry) out[userid] = rec;
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.writeFile(BRIDGE_PLAYERS, JSON.stringify(out, null, 2)).catch(() => {});
}

function recordPlayer(event: BridgeEvent): void {
  const userid = String(event.userid ?? '');
  if (!userid) return;
  const at = Number(event.at) || Math.floor(Date.now() / 1000);
  const name = String(event.player ?? '') || 'Unknown';
  const existing = playerRegistry.get(userid);
  const record: PlayerRecord = existing ?? {
    userid, name, firstSeen: at, lastSeen: at, joins: 0, online: false,
  };
  if (name !== 'Unknown') record.name = name;
  record.lastSeen = Math.max(record.lastSeen, at);
  if (event.type === 'join') {
    record.joins += 1;
    record.online = true;
  } else if (event.type === 'leave') {
    record.online = false;
  }
  playerRegistry.set(userid, record);
  registryDirty = true;
}

// ── action results ───────────────────────────────────────────────────────────
// The agent reports the outcome of every request back onto the event stream, so
// a caller that posted an action can be answered synchronously.
const actionWaiters = new Map<string, (event: BridgeEvent) => void>();

function ingest(event: BridgeEvent): void {
  if (!bridgeRun.types.includes(event.type)) bridgeRun.types.push(event.type);
  bridgeRun.lastEventAt = Math.max(bridgeRun.lastEventAt, Number(event.at) || 0);

  switch (event.type) {
    case 'ready':
      bridgeRun.agent = String(event.agent ?? 'unknown');
      bridgeRun.version = String(event.version ?? '');
      bridgeRun.schema = Number(event.schema) || null;
      bridgeRun.actions = String(event.actions ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      break;
    case 'hook': {
      const hook = { hook: String(event.hook ?? ''), target: String(event.target ?? ''), ok: event.ok === true };
      const at = bridgeRun.hooks.findIndex((h) => h.target === hook.target);
      if (at >= 0) bridgeRun.hooks[at] = hook;
      else bridgeRun.hooks.push(hook);
      break;
    }
    case 'action': {
      const waiter = actionWaiters.get(String(event.id ?? ''));
      if (waiter) waiter(event);
      break;
    }
    default:
      recordPlayer(event);
  }
}

app.get<{ Querystring: { since?: string; limit?: string; type?: string } }>(
  '/api/bridge/events',
  async (req) => {
    const since = Math.max(0, Number(req.query.since ?? 0) || 0);
    const limit = Math.min(Math.max(Number(req.query.limit ?? 200) || 200, 1), 500);
    const result = await readBridge(since, limit);
    const wanted = (req.query.type ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    // Filtering happens after the cursor is computed, so a caller narrowing to
    // one type still advances past everything it skipped.
    if (!wanted.length) return result;
    return { ...result, events: result.events.filter((e) => wanted.includes(e.type)) };
  },
);

app.get('/api/bridge/status', async () => ({
  // The agent announces itself at load; nothing else can, so its absence is
  // what "not available" means.
  available: bridgeRun.agent !== null,
  agent: bridgeRun.agent,
  version: bridgeRun.version,
  schema: bridgeRun.schema,
  actions: bridgeRun.actions,
  hooks: bridgeRun.hooks,
  eventTypes: bridgeRun.types,
  lastEventAt: bridgeRun.lastEventAt,
  online: (await palSafe('GET', 'info')) !== null,
}));

app.get('/api/bridge/players', async () => ({
  players: [...playerRegistry.values()].sort((a, b) => b.lastSeen - a.lastSeen),
}));

// ── sending actions into the game ────────────────────────────────────────────
// Requests are tab-separated key=value lines rather than JSON: the agent has no
// JSON parser, and a format with no structure has nothing to exploit. Values
// are stripped of separators here, which is the only place they can be.
function actionField(value: unknown): string {
  return String(value ?? '').replace(/[\t\r\n]/g, ' ').slice(0, 512);
}

async function enqueueAction(action: string, params: Record<string, unknown>): Promise<string> {
  const id = randomBytes(8).toString('hex');
  const parts = [`id=${id}`, `action=${actionField(action)}`];
  for (const [key, value] of Object.entries(params)) {
    if (!ACTION_KEY_RE.test(key) || value === undefined || value === null) continue;
    parts.push(`${key}=${actionField(value)}`);
  }
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.appendFile(BRIDGE_ACTIONS, parts.join('\t') + '\n');
  return id;
}

function awaitAction(id: string, timeoutMs: number): Promise<BridgeEvent | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      actionWaiters.delete(id);
      resolve(null);
    }, timeoutMs);
    actionWaiters.set(id, (event) => {
      clearTimeout(timer);
      actionWaiters.delete(id);
      resolve(event);
    });
  });
}

app.post<{ Body: { action?: string; userid?: string; [key: string]: unknown } }>(
  '/api/bridge/actions',
  async (req, reply) => {
    const { action, ...params } = req.body ?? {};
    if (!action) return reply.code(400).send({ error: 'action required' });
    // The agent is the authority on what it can do; before it has announced
    // itself there is nothing listening and the request would hang.
    if (!bridgeRun.agent) return reply.code(409).send({ error: 'bridge agent not loaded' });
    if (!bridgeRun.actions.includes(action)) {
      return reply.code(400).send({ error: `unknown action: ${action}`, supported: bridgeRun.actions });
    }
    const id = await enqueueAction(action, params);
    const result = await awaitAction(id, ACTION_TIMEOUT_MS);
    if (!result) {
      await panelLog(`bridge action ${action} — no response from the game`);
      return reply.code(504).send({ id, ok: false, error: 'the game did not answer in time' });
    }
    await panelLog(
      `bridge action ${action}${params.userid ? ` → ${params.userid}` : ''} — ` +
      (result.ok === true ? `ok (${result.detail ?? ''})` : `failed (${result.detail ?? ''})`),
    );
    return { id, ok: result.ok === true, detail: result.detail ?? '', event: result };
  },
);

// ── chat command routing ─────────────────────────────────────────────────────
// Routing lives here, not in the mod: the in-game agent stays a plain event
// source, so a new command is a table entry plus a daemon restart rather than a
// Lua change plus a game restart.
const COMMAND_PREFIX = '!';
const COMMAND_COOLDOWN_MS = 2000;

interface ChatCommand {
  run: (event: BridgeEvent, args: string) => Promise<unknown>;
  audit: (event: BridgeEvent, args: string) => string;
}

const CHAT_COMMANDS: Record<string, ChatCommand> = {
  ping: {
    run: () => pal('POST', 'announce', { message: 'pong' }),
    audit: (e) => `chat !ping from ${e.player || 'unknown'} — announced "pong"`,
  },
};

// Chat is untrusted input: one command per player per cooldown window, so a
// spamming client cannot turn the broadcast endpoint into an amplifier.
const lastCommandAt = new Map<string, number>();

function commandAllowed(key: string, now: number): boolean {
  const previous = lastCommandAt.get(key);
  if (previous !== undefined && now - previous < COMMAND_COOLDOWN_MS) return false;
  lastCommandAt.set(key, now);
  if (lastCommandAt.size > 256) {
    for (const [k, at] of lastCommandAt) {
      if (now - at >= COMMAND_COOLDOWN_MS) lastCommandAt.delete(k);
    }
  }
  return true;
}

async function routeChat(event: BridgeEvent): Promise<void> {
  const text = (event.message ?? '').trim();
  if (!text.startsWith(COMMAND_PREFIX)) return;
  const [word, ...rest] = text.slice(COMMAND_PREFIX.length).split(/\s+/);
  const command = CHAT_COMMANDS[word.toLowerCase()];
  if (!command) return;
  if (!commandAllowed(event.userid || event.player || 'unknown', Date.now())) return;
  const args = rest.join(' ');
  try {
    await command.run(event, args);
    await panelLog(command.audit(event, args));
  } catch (err) {
    await panelLog(`chat !${word} failed: ${(err as Error).message}`);
  }
}

// The poller is the only consumer that must never miss an event, so it holds
// its own cursor.
let bridgeCursor = 0;
let bridgePolling = false;

async function pollBridge(route: boolean): Promise<void> {
  if (bridgePolling) return;
  bridgePolling = true;
  try {
    for (;;) {
      const { events, cursor } = await readBridge(bridgeCursor, 200);
      // A cursor that moved backwards means the file was emptied: the server
      // rebooted, so the previous run's hooks and online flags are stale.
      if (cursor < bridgeCursor) {
        bridgeRun = emptyRun();
        for (const rec of playerRegistry.values()) rec.online = false;
      }
      bridgeCursor = cursor;
      if (!events.length) break;
      for (const event of events) {
        ingest(event);
        if (route && event.type === 'chat') await routeChat(event);
      }
    }
    await flushRegistry();
  } catch (err) {
    app.log.warn({ err }, 'bridge poll failed');
  } finally {
    bridgePolling = false;
  }
}

// ── leave events ─────────────────────────────────────────────────────────────
// Nothing in the engine exposes a disconnect this loader can hook — Blueprint
// function targets fault the process — so leaves are derived from the game's
// own player list and appended to the same stream. Consumers cannot tell the
// difference apart from the `source` field, which is the point.
let lastSeenPlayers: Map<string, string> | null = null; // game id → name

async function appendLeave(gameId: string, name: string): Promise<void> {
  // The agent renders PlayerUId exactly as the REST API reports playerId, so
  // the two halves of the stream normally agree on the id outright. Matching by
  // name is the fallback for a player the agent never announced — it joined
  // before the mod loaded, or the join hook is stale after a game patch.
  const byId = playerRegistry.get(gameId.toUpperCase());
  const known = byId ?? [...playerRegistry.values()].find((p) => p.online && p.name === name);
  const line = JSON.stringify({
    v: 1,
    at: Math.floor(Date.now() / 1000),
    type: 'leave',
    player: name || known?.name || 'Unknown',
    userid: known?.userid ?? gameId,
    source: 'rest',
  });
  await fs.appendFile(BRIDGE_EVENTS, line + '\n').catch(() => {});
}

async function pollPlayers(): Promise<void> {
  if (!bridgeRun.agent) return; // no agent, no stream to contribute to
  const payload = (await palSafe('GET', 'players')) as { players?: Record<string, unknown>[] } | null;
  if (payload === null) {
    // The API being unreachable is not everyone leaving at once; forget the
    // previous list so the next successful poll starts a fresh comparison.
    lastSeenPlayers = null;
    return;
  }
  const current = new Map<string, string>();
  for (const p of payload.players ?? []) {
    const id = String(p.playerId ?? p.userId ?? p.name ?? '');
    if (id) current.set(id, String(p.name ?? ''));
  }
  if (lastSeenPlayers) {
    for (const [id, name] of lastSeenPlayers) {
      if (!current.has(id)) await appendLeave(id, name);
    }
  }
  lastSeenPlayers = current;
}

// Startup reads the whole run so status and the registry reflect it, but with
// routing off: commands answered before this daemon started must not fire again.
async function hydrateBridge(): Promise<void> {
  await loadRegistry();
  bridgeCursor = 0;
  await pollBridge(false);
}

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
    const a = req.body?.args ?? {};
    const audit: Record<string, string> = {
      announce: `broadcast — "${a.message ?? ''}"`,
      save: 'world save requested',
      kick: `kick — ${a.userid ?? ''}`,
      ban: `ban — ${a.userid ?? ''}`,
      unban: `unban — ${a.userid ?? ''}`,
      shutdown: `shutdown via console — ${a.waittime ?? 30}s warning`,
      stop: 'force stop via console',
    };
    if (audit[command]) await panelLog(audit[command]);
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

await hydrateBridge();
setInterval(() => void pollBridge(true), 1000).unref();
setInterval(() => void pollPlayers(), 5000).unref();

await app.listen({ host: '0.0.0.0', port: PANEL_PORT });
