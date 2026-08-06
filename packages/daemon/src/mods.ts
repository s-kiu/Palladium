// Mod folders: what is in them, and running the ones that are the panel's to
// run.
//
// A mod is one folder in ./mods, and what is inside decides who loads it:
// mod.lua is Palladium's, inside the game; Scripts/main.lua is UE4SS's;
// mod.json is this daemon's, as a child process out here. Only the last needs
// anything from this file — the other two are recognised so they are not
// mistaken for it.
//
// The manifest is the reason a script mod's author writes no boilerplate: the
// panel reads the permission nodes out of it and registers them, so the author
// declares what they own instead of remembering to call permission.register on
// every startup.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export interface ModPermission {
  node: string;
  description: string;
  default: 'allow' | 'deny';
}

export interface ModManifest {
  name: string;
  version: string;
  description: string;
  entry: string | null;
  permissions: ModPermission[];
  settings: Record<string, unknown>;
}

export interface ScannedMod {
  name: string;
  dir: string;
  // `hasManifest` is whether the folder claims to be a script mod at all;
  // `manifest` is whether that claim parsed. A mod.json with a syntax error
  // has to stay a script mod, or the one place the error is visible is the one
  // place it stops being listed.
  hasManifest: boolean;
  manifest: ModManifest | null;
  hasLua: boolean;
  // A mod.lua means Palladium loads this one inside the game. The panel does
  // not run it and UE4SS does not either, so it belongs in neither list here.
  hasFramework: boolean;
  disabled: boolean;
  errors: string[];
  fingerprint: string;
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const NODE_RE = /^[a-z0-9_-]+(\.[a-z0-9_*-]+)+$/;
// The name a mod registers permissions under, matching what the bridge's own
// permission.register accepts.
const MOD_NAME_RE = /^[a-z0-9_-]{2,32}$/;
const ENTRY_RE = /\.(mjs|js|ts|mts)$/;

// ── the manifest ─────────────────────────────────────────────────────────────

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

// Errors are collected rather than thrown: a mod with a broken manifest is
// reported in the panel next to the working ones, not a reason to take the
// daemon down on boot.
function parseManifest(name: string, raw: unknown, errors: string[]): ModManifest | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    errors.push('mod.json is not an object');
    return null;
  }
  const m = raw as Record<string, unknown>;

  const declared = asString(m.name, name);
  if (declared !== name) errors.push(`mod.json says name "${declared}" but the folder is "${name}"`);

  let entry: string | null = null;
  if (m.entry !== undefined && m.entry !== null) {
    const value = asString(m.entry);
    if (!value) errors.push('entry must be a path relative to the mod folder');
    else if (path.isAbsolute(value) || value.split(/[\\/]/).includes('..')) {
      errors.push(`entry must stay inside the mod folder: "${value}"`);
    } else if (!ENTRY_RE.test(value)) {
      errors.push(`entry must be .mjs, .js, .ts or .mts: "${value}"`);
    } else {
      entry = value;
    }
  }

  // A mod owns its namespace and only its namespace, or one mod could quietly
  // redefine another's permissions by declaring them first.
  const prefix = `${name.toLowerCase()}.`;
  const permissions: ModPermission[] = [];
  const rawPerms = Array.isArray(m.permissions) ? m.permissions : [];
  if (m.permissions !== undefined && !Array.isArray(m.permissions)) errors.push('permissions must be a list');
  if (rawPerms.length > 0 && !MOD_NAME_RE.test(name.toLowerCase())) {
    errors.push(`"${name}" cannot own permission nodes — use 2-32 letters, digits, _ or -`);
    return { name, version: asString(m.version, '0.0.0'), description: asString(m.description), entry, permissions, settings: {} };
  }
  for (const p of rawPerms) {
    if (typeof p !== 'object' || p === null) {
      errors.push('each permission must be an object');
      continue;
    }
    const entryP = p as Record<string, unknown>;
    const node = asString(entryP.node).toLowerCase();
    if (!NODE_RE.test(node)) {
      errors.push(`not a permission node: "${asString(entryP.node)}"`);
      continue;
    }
    if (!node.startsWith(prefix)) {
      errors.push(`permission "${node}" must start with "${prefix}" — a mod owns its own nodes`);
      continue;
    }
    const def = asString(entryP.default, 'deny');
    if (def !== 'allow' && def !== 'deny') {
      errors.push(`permission "${node}": default must be "allow" or "deny"`);
      continue;
    }
    permissions.push({ node, description: asString(entryP.description), default: def });
  }

  const settingsOk = typeof m.settings === 'object' && m.settings !== null && !Array.isArray(m.settings);
  if (m.settings !== undefined && !settingsOk) errors.push('settings must be an object');
  const settings = settingsOk ? (m.settings as Record<string, unknown>) : {};

  return {
    name,
    version: asString(m.version, '0.0.0'),
    description: asString(m.description),
    entry,
    permissions,
    settings,
  };
}

// ── scanning ─────────────────────────────────────────────────────────────────

async function statMtime(file: string): Promise<number> {
  try {
    return (await fs.stat(file)).mtimeMs;
  } catch {
    return 0;
  }
}

export async function scanMods(modsDir: string): Promise<ScannedMod[]> {
  let dirents;
  try {
    dirents = await fs.readdir(modsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: ScannedMod[] = [];
  for (const dirent of dirents) {
    if (!dirent.isDirectory() || !NAME_RE.test(dirent.name)) continue;
    const dir = path.join(modsDir, dirent.name);
    const errors: string[] = [];

    let manifest: ModManifest | null = null;
    let manifestMtime = 0;
    const manifestPath = path.join(dir, 'mod.json');
    const rawText = await fs.readFile(manifestPath, 'utf8').catch(() => null);
    if (rawText !== null) {
      manifestMtime = await statMtime(manifestPath);
      try {
        manifest = parseManifest(dirent.name, JSON.parse(rawText), errors);
      } catch (err) {
        errors.push(`mod.json is not valid JSON: ${(err as Error).message}`);
      }
    }

    // An entry the manifest names but the folder does not have is the one
    // manifest error worth checking against the disk.
    let entryMtime = 0;
    if (manifest?.entry) {
      const abs = path.join(dir, manifest.entry);
      entryMtime = await statMtime(abs);
      if (entryMtime === 0) {
        errors.push(`entry "${manifest.entry}" does not exist`);
        manifest = { ...manifest, entry: null };
      }
    }

    const [hasLua, hasLuaLower, hasFramework, disabled] = await Promise.all([
      fs.stat(path.join(dir, 'Scripts')).then((s) => s.isDirectory()).catch(() => false),
      fs.stat(path.join(dir, 'scripts')).then((s) => s.isDirectory()).catch(() => false),
      fs.stat(path.join(dir, 'mod.lua')).then((s) => s.isFile()).catch(() => false),
      fs.stat(path.join(dir, '.disabled')).then(() => true).catch(() => false),
    ]);

    out.push({
      name: dirent.name,
      dir,
      hasManifest: rawText !== null,
      manifest,
      hasLua: hasLua || hasLuaLower,
      hasFramework,
      disabled,
      errors,
      fingerprint: `${manifestMtime}:${entryMtime}:${disabled}`,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ── running the script half ──────────────────────────────────────────────────

export interface LogLine {
  at: number;
  stream: 'out' | 'err';
  text: string;
}

export type RunState = 'running' | 'starting' | 'stopped' | 'disabled' | 'failed' | 'invalid' | 'none';

interface Running {
  child: ChildProcess | null;
  fingerprint: string;
  logs: LogLine[];
  state: RunState;
  startedAt: number;
  restarts: number;
  note: string;
  stopping: boolean;
  timer: NodeJS.Timeout | null;
}

const LOG_LINES = 200;
const LINE_MAX = 2000;
const BACKOFF_MIN_MS = 2000;
const BACKOFF_MAX_MS = 60_000;
const HEALTHY_MS = 60_000;

// The host process lives beside the compiled daemon in the image and beside
// its source in a dev checkout; both are one hop from here.
function hostScript(): string | null {
  const override = process.env.PALUP_MOD_SDK;
  const candidates = override
    ? [path.join(override, 'host.mjs')]
    : [path.join(HERE, '..', 'mod-sdk', 'host.mjs'), path.join(HERE, '..', '..', 'mod-sdk', 'host.mjs')];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export interface RunnerOptions {
  panelUrl: string;
  mintToken: (mod: string) => string;
  log: (text: string) => void;
}

export class ModRunner {
  #running = new Map<string, Running>();
  #opts: RunnerOptions;
  #host: string | null;
  #shuttingDown = false;

  constructor(opts: RunnerOptions) {
    this.#opts = opts;
    this.#host = hostScript();
  }

  get hostFound(): boolean {
    return this.#host !== null;
  }

  view(mod: ScannedMod): { state: RunState; note: string; restarts: number; startedAt: number } {
    const slot = this.#running.get(mod.name);
    if (slot) return { state: slot.state, note: slot.note, restarts: slot.restarts, startedAt: slot.startedAt };
    if (mod.errors.length) return { state: 'invalid', note: mod.errors[0], restarts: 0, startedAt: 0 };
    if (!mod.manifest?.entry) return { state: 'none', note: '', restarts: 0, startedAt: 0 };
    if (mod.disabled) return { state: 'disabled', note: '', restarts: 0, startedAt: 0 };
    return { state: 'stopped', note: '', restarts: 0, startedAt: 0 };
  }

  logs(name: string): LogLine[] {
    return this.#running.get(name)?.logs ?? [];
  }

  // Brings the running set in line with what is on disk: start what should be
  // running, stop what should not, restart what changed underneath us.
  async sync(mods: ScannedMod[]): Promise<void> {
    if (this.#shuttingDown) return;
    const wanted = new Map<string, ScannedMod>();
    for (const mod of mods) {
      if (mod.manifest?.entry && !mod.disabled && mod.errors.length === 0) wanted.set(mod.name, mod);
    }

    for (const [name, slot] of this.#running) {
      const mod = wanted.get(name);
      if (!mod) {
        this.#stop(name, 'no longer runnable');
      } else if (mod.fingerprint !== slot.fingerprint) {
        this.#stop(name, 'changed on disk');
        this.#start(mod);
      }
    }
    for (const [name, mod] of wanted) {
      if (!this.#running.has(name)) this.#start(mod);
    }
  }

  stopAll(): void {
    this.#shuttingDown = true;
    for (const name of [...this.#running.keys()]) this.#stop(name, 'panel shutting down');
  }

  #stop(name: string, why: string): void {
    const slot = this.#running.get(name);
    if (!slot) return;
    slot.stopping = true;
    if (slot.timer) clearTimeout(slot.timer);
    if (slot.child && slot.child.exitCode === null) {
      slot.child.kill('SIGTERM');
      const child = slot.child;
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, 5000).unref();
    }
    this.#running.delete(name);
    this.#opts.log(`mod ${name} stopped — ${why}`);
  }

  #start(mod: ScannedMod, restarts = 0, keepLogs: LogLine[] = []): void {
    if (this.#shuttingDown) return;
    const manifest = mod.manifest;
    if (!manifest?.entry) return;

    const slot: Running = {
      child: null,
      fingerprint: mod.fingerprint,
      logs: keepLogs,
      state: 'starting',
      startedAt: Date.now(),
      restarts,
      note: '',
      stopping: false,
      timer: null,
    };
    this.#running.set(mod.name, slot);

    if (!this.#host) {
      slot.state = 'failed';
      slot.note = 'the mod host is missing from this image';
      return;
    }

    let child: ChildProcess;
    try {
      child = spawn(
        process.execPath,
        [this.#host],
        {
          cwd: mod.dir,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            PATH: process.env.PATH ?? '',
            HOME: process.env.HOME ?? '/tmp',
            NODE_ENV: 'production',
            PANEL_URL: this.#opts.panelUrl,
            PALUP_TOKEN: this.#opts.mintToken(mod.name),
            PALUP_MOD_NAME: mod.name,
            PALUP_MOD_ENTRY: path.join(mod.dir, manifest.entry),
            PALUP_MOD_SETTINGS: JSON.stringify(manifest.settings),
          },
        },
      );
    } catch (err) {
      slot.state = 'failed';
      slot.note = (err as Error).message;
      return;
    }

    slot.child = child;
    slot.state = 'running';
    this.#opts.log(`mod ${mod.name} started (pid ${child.pid})`);

    this.#pipe(slot, child, 'out');
    this.#pipe(slot, child, 'err');

    child.on('error', (err) => {
      this.#append(slot, 'err', err.message);
    });

    child.on('exit', (code, signal) => {
      if (slot.stopping || this.#shuttingDown) return;
      const how = signal ? `signal ${signal}` : `code ${code}`;
      this.#append(slot, 'err', `— exited with ${how}`);

      // A clean exit is a mod that decided it was done. Only failure gets the
      // restart treatment, and a mod that fails instantly backs off rather
      // than spinning against a broken file for the life of the panel.
      if (code === 0 && !signal) {
        slot.state = 'stopped';
        slot.note = 'exited';
        return;
      }
      const lived = Date.now() - slot.startedAt;
      const next = lived > HEALTHY_MS ? 0 : slot.restarts + 1;
      const delay = next === 0 ? BACKOFF_MIN_MS : Math.min(BACKOFF_MIN_MS * 2 ** next, BACKOFF_MAX_MS);
      slot.state = 'failed';
      slot.note = `exited with ${how} — restarting in ${Math.round(delay / 1000)}s`;
      slot.timer = setTimeout(() => {
        if (this.#running.get(mod.name) !== slot) return;
        this.#running.delete(mod.name);
        this.#start(mod, next, slot.logs);
      }, delay);
      slot.timer.unref();
    });
  }

  #pipe(slot: Running, child: ChildProcess, stream: 'out' | 'err'): void {
    const source = stream === 'out' ? child.stdout : child.stderr;
    if (!source) return;
    let buffer = '';
    source.setEncoding('utf8');
    source.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) this.#append(slot, stream, line);
      if (buffer.length > LINE_MAX) {
        this.#append(slot, stream, buffer.slice(0, LINE_MAX));
        buffer = '';
      }
    });
  }

  #append(slot: Running, stream: 'out' | 'err', text: string): void {
    slot.logs.push({ at: Date.now(), stream, text: text.slice(0, LINE_MAX) });
    if (slot.logs.length > LOG_LINES) slot.logs.splice(0, slot.logs.length - LOG_LINES);
  }
}
