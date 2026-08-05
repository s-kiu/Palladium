// Bridge storage — SQLite on the shared volume, daemon-owned.
//
// node:sqlite keeps this dependency-free: no server to run, no native module
// to compile, still one file (.state/bridge.db) that survives container
// rebuilds. Everything here is synchronous by design — call volumes are tiny
// (events trickle in at human speed) and it keeps the call sites simple.

import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface PlayerRow {
  userid: string;
  name: string;
  firstSeen: number;
  lastSeen: number;
  joins: number;
  online: boolean;
  tags: Record<string, string>;
}

export interface TokenRow {
  id: string;
  name: string;
  scopes: string[];
  createdAt: number;
  lastUsedAt: number | null;
}

export class BridgeDb {
  private db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS players (
        userid     TEXT PRIMARY KEY,
        name       TEXT NOT NULL DEFAULT 'Unknown',
        first_seen INTEGER NOT NULL,
        last_seen  INTEGER NOT NULL,
        joins      INTEGER NOT NULL DEFAULT 0,
        online     INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        userid    TEXT NOT NULL,
        joined_at INTEGER NOT NULL,
        left_at   INTEGER,
        UNIQUE (userid, joined_at)
      );
      CREATE TABLE IF NOT EXISTS tags (
        userid     TEXT NOT NULL,
        key        TEXT NOT NULL,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (userid, key)
      );
      CREATE TABLE IF NOT EXISTS tokens (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        hash         TEXT NOT NULL UNIQUE,
        scopes       TEXT NOT NULL,
        created_at   INTEGER NOT NULL,
        last_used_at INTEGER,
        revoked      INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS species_seen (
        species   TEXT PRIMARY KEY,
        min_level INTEGER NOT NULL,
        max_level INTEGER NOT NULL,
        count     INTEGER NOT NULL DEFAULT 0,
        rare      INTEGER NOT NULL DEFAULT 0,
        last_at   INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS perm_nodes (
        node           TEXT PRIMARY KEY,
        mod            TEXT NOT NULL,
        description    TEXT NOT NULL DEFAULT '',
        default_effect TEXT NOT NULL DEFAULT 'deny',
        registered_at  INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS perm_groups (
        name       TEXT PRIMARY KEY,
        tag        TEXT NOT NULL DEFAULT '',
        weight     INTEGER NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS perm_group_entries (
        grp         TEXT NOT NULL,
        node        TEXT NOT NULL,
        effect      TEXT NOT NULL,
        constraints TEXT,
        PRIMARY KEY (grp, node)
      );
      CREATE TABLE IF NOT EXISTS perm_user_groups (
        userid TEXT NOT NULL,
        grp    TEXT NOT NULL,
        PRIMARY KEY (userid, grp)
      );
      CREATE TABLE IF NOT EXISTS perm_user_entries (
        userid      TEXT NOT NULL,
        node        TEXT NOT NULL,
        effect      TEXT NOT NULL,
        constraints TEXT,
        PRIMARY KEY (userid, node)
      );
      CREATE TABLE IF NOT EXISTS locations (
        name       TEXT PRIMARY KEY,
        x          REAL NOT NULL,
        y          REAL NOT NULL,
        z          REAL NOT NULL,
        source     TEXT NOT NULL DEFAULT 'manual',
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bridge_options (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit (
        id     INTEGER PRIMARY KEY AUTOINCREMENT,
        at     INTEGER NOT NULL,
        actor  TEXT NOT NULL,
        type   TEXT NOT NULL,
        target TEXT,
        ok     INTEGER NOT NULL,
        detail TEXT
      );
    `);
  }

  // ── players & sessions ─────────────────────────────────────────────────────
  seen(userid: string, name: string, at: number): void {
    if (!userid) return;
    this.db.prepare(`
      INSERT INTO players (userid, name, first_seen, last_seen)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(userid) DO UPDATE SET
        last_seen = MAX(last_seen, excluded.last_seen),
        name = CASE WHEN excluded.name != 'Unknown' THEN excluded.name ELSE name END
    `).run(userid, name || 'Unknown', at, at);
  }

  join(userid: string, name: string, at: number): void {
    if (!userid) return;
    this.seen(userid, name, at);
    // Idempotent by (userid, joined_at): hydration replays the run's events
    // after a daemon restart and must not double-count.
    const inserted = this.db.prepare(
      'INSERT OR IGNORE INTO sessions (userid, joined_at) VALUES (?, ?)',
    ).run(userid, at);
    if (Number(inserted.changes) > 0) {
      this.db.prepare('UPDATE players SET joins = joins + 1, online = 1 WHERE userid = ?').run(userid);
    } else {
      this.db.prepare('UPDATE players SET online = 1 WHERE userid = ?').run(userid);
    }
  }

  leave(userid: string, at: number): void {
    if (!userid) return;
    this.db.prepare(
      'UPDATE sessions SET left_at = ? WHERE userid = ? AND left_at IS NULL',
    ).run(at, userid);
    this.db.prepare('UPDATE players SET online = 0, last_seen = MAX(last_seen, ?) WHERE userid = ?')
      .run(at, userid);
  }

  allOffline(): void {
    this.db.exec('UPDATE players SET online = 0');
  }

  // firstEver must hold for a replayed event too: true iff this join IS the
  // player's earliest recorded session.
  isFirstSession(userid: string, at: number): boolean {
    const row = this.db.prepare(
      'SELECT MIN(joined_at) AS first FROM sessions WHERE userid = ?',
    ).get(userid) as { first: number | null } | undefined;
    return row?.first === at || row?.first === null;
  }

  player(userid: string): PlayerRow | null {
    const row = this.db.prepare('SELECT * FROM players WHERE userid = ?').get(userid) as
      | Record<string, unknown>
      | undefined;
    return row ? this.toPlayer(row) : null;
  }

  players(): PlayerRow[] {
    const rows = this.db.prepare('SELECT * FROM players ORDER BY last_seen DESC').all() as
      Record<string, unknown>[];
    return rows.map((r) => this.toPlayer(r));
  }

  private toPlayer(row: Record<string, unknown>): PlayerRow {
    const tags: Record<string, string> = {};
    const tagRows = this.db.prepare('SELECT key, value FROM tags WHERE userid = ?')
      .all(String(row.userid)) as { key: string; value: string }[];
    for (const t of tagRows) tags[t.key] = t.value;
    return {
      userid: String(row.userid),
      name: String(row.name),
      firstSeen: Number(row.first_seen),
      lastSeen: Number(row.last_seen),
      joins: Number(row.joins),
      online: Number(row.online) === 1,
      tags,
    };
  }

  // ── tags ───────────────────────────────────────────────────────────────────
  setTag(userid: string, key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO tags (userid, key, value, updated_at) VALUES (?, ?, ?, unixepoch())
      ON CONFLICT(userid, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(userid, key, value);
  }

  getTag(userid: string, key: string): string | null {
    const row = this.db.prepare('SELECT value FROM tags WHERE userid = ? AND key = ?')
      .get(userid, key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  deleteTag(userid: string, key: string): void {
    this.db.prepare('DELETE FROM tags WHERE userid = ? AND key = ?').run(userid, key);
  }

  // ── species observed in the world ──────────────────────────────────────────
  // Fed by npc.spawn events. This is how the catalog learns what actually
  // exists on THIS server — spawn-level ranges, and species no static table
  // knows because a mod added them.
  speciesSeen(species: string, level: number, rare: boolean, at: number): void {
    if (!species) return;
    this.db.prepare(`
      INSERT INTO species_seen (species, min_level, max_level, count, rare, last_at)
      VALUES (?, ?, ?, 1, ?, ?)
      ON CONFLICT(species) DO UPDATE SET
        min_level = MIN(min_level, excluded.min_level),
        max_level = MAX(max_level, excluded.max_level),
        count = count + 1,
        rare = MAX(rare, excluded.rare),
        last_at = MAX(last_at, excluded.last_at)
    `).run(species, level, level, rare ? 1 : 0, at);
  }

  species(): Map<string, { min: number; max: number; count: number; rare: boolean }> {
    const rows = this.db.prepare('SELECT * FROM species_seen').all() as Record<string, unknown>[];
    return new Map(rows.map((r) => [
      String(r.species),
      {
        min: Number(r.min_level),
        max: Number(r.max_level),
        count: Number(r.count),
        rare: Number(r.rare) === 1,
      },
    ]));
  }

  // ── API tokens ─────────────────────────────────────────────────────────────
  // Only the hash is stored; the token value exists once, in the creation
  // response. palup_ prefix makes leaked tokens greppable.
  createToken(name: string, scopes: string[]): { id: string; token: string } {
    const id = randomBytes(4).toString('hex');
    const token = 'palup_' + randomBytes(24).toString('hex');
    this.db.prepare(
      'INSERT INTO tokens (id, name, hash, scopes, created_at) VALUES (?, ?, ?, ?, unixepoch())',
    ).run(id, name, sha256(token), JSON.stringify(scopes));
    return { id, token };
  }

  findToken(token: string): TokenRow | null {
    const row = this.db.prepare(
      'SELECT * FROM tokens WHERE hash = ? AND revoked = 0',
    ).get(sha256(token)) as Record<string, unknown> | undefined;
    if (!row) return null;
    this.db.prepare('UPDATE tokens SET last_used_at = unixepoch() WHERE id = ?').run(String(row.id));
    return {
      id: String(row.id),
      name: String(row.name),
      scopes: JSON.parse(String(row.scopes)),
      createdAt: Number(row.created_at),
      lastUsedAt: row.last_used_at === null ? null : Number(row.last_used_at),
    };
  }

  listTokens(): TokenRow[] {
    const rows = this.db.prepare(
      'SELECT id, name, scopes, created_at, last_used_at FROM tokens WHERE revoked = 0 ORDER BY created_at',
    ).all() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      scopes: JSON.parse(String(row.scopes)),
      createdAt: Number(row.created_at),
      lastUsedAt: row.last_used_at === null ? null : Number(row.last_used_at),
    }));
  }

  revokeToken(id: string): boolean {
    const res = this.db.prepare('UPDATE tokens SET revoked = 1 WHERE id = ?').run(id);
    return Number(res.changes) > 0;
  }

  // ── permissions ────────────────────────────────────────────────────────────
  // Model: dotted nodes with wildcards, registered by the mod that owns them
  // (with a default), granted through groups and per-user overrides. An entry
  // can carry constraints — per-parameter matchers like {"species":{"in":[…]}}
  // — which is how "may spawn, but only Lamball" stays one permission rather
  // than a species-long list of them.
  //
  // Resolution order is what makes it predictable: user entries beat group
  // entries, groups are consulted by weight (highest first) then the default
  // group, and within one source a more specific node beats a wildcard with
  // deny winning ties. No entry anywhere → the node's registered default →
  // deny if nobody registered it.

  ensureDefaultGroup(): void {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM perm_groups WHERE is_default = 1')
      .get() as { n: number };
    if (Number(row.n) === 0) {
      this.db.prepare(
        "INSERT OR IGNORE INTO perm_groups (name, tag, weight, is_default) VALUES ('default', '', 0, 1)",
      ).run();
    }
  }

  registerNodes(
    mod: string,
    nodes: { node: string; description?: string; default?: string }[],
  ): number {
    let count = 0;
    for (const n of nodes) {
      this.db.prepare(`
        INSERT INTO perm_nodes (node, mod, description, default_effect, registered_at)
        VALUES (?, ?, ?, ?, unixepoch())
        ON CONFLICT(node) DO UPDATE SET
          mod = excluded.mod,
          description = excluded.description,
          default_effect = excluded.default_effect
      `).run(n.node, mod, n.description ?? '', n.default === 'allow' ? 'allow' : 'deny');
      count += 1;
    }
    return count;
  }

  nodes(): { node: string; mod: string; description: string; default: string }[] {
    const rows = this.db.prepare('SELECT * FROM perm_nodes ORDER BY mod, node').all() as
      Record<string, unknown>[];
    return rows.map((r) => ({
      node: String(r.node),
      mod: String(r.mod),
      description: String(r.description),
      default: String(r.default_effect),
    }));
  }

  groupCreate(name: string, tag: string, weight: number): void {
    this.db.prepare('INSERT INTO perm_groups (name, tag, weight) VALUES (?, ?, ?)')
      .run(name, tag, weight);
  }

  groupUpdate(name: string, tag: string, weight: number): boolean {
    const res = this.db.prepare('UPDATE perm_groups SET tag = ?, weight = ? WHERE name = ?')
      .run(tag, weight, name);
    return Number(res.changes) > 0;
  }

  groupDelete(name: string): boolean {
    const row = this.db.prepare('SELECT is_default FROM perm_groups WHERE name = ?').get(name) as
      { is_default: number } | undefined;
    if (!row || Number(row.is_default) === 1) return false;
    this.db.prepare('DELETE FROM perm_groups WHERE name = ?').run(name);
    this.db.prepare('DELETE FROM perm_group_entries WHERE grp = ?').run(name);
    this.db.prepare('DELETE FROM perm_user_groups WHERE grp = ?').run(name);
    return true;
  }

  groups(): {
    name: string; tag: string; weight: number; isDefault: boolean;
    entries: { node: string; effect: string; constraints: unknown }[];
    members: number;
  }[] {
    const rows = this.db.prepare('SELECT * FROM perm_groups ORDER BY weight DESC, name').all() as
      Record<string, unknown>[];
    return rows.map((g) => {
      const name = String(g.name);
      const entries = (this.db.prepare('SELECT * FROM perm_group_entries WHERE grp = ? ORDER BY node')
        .all(name) as Record<string, unknown>[]).map((e) => ({
          node: String(e.node),
          effect: String(e.effect),
          constraints: e.constraints ? JSON.parse(String(e.constraints)) : null,
        }));
      const members = this.db.prepare('SELECT COUNT(*) AS n FROM perm_user_groups WHERE grp = ?')
        .get(name) as { n: number };
      return {
        name,
        tag: String(g.tag),
        weight: Number(g.weight),
        isDefault: Number(g.is_default) === 1,
        entries,
        members: Number(members.n),
      };
    });
  }

  groupExists(name: string): boolean {
    return this.db.prepare('SELECT 1 FROM perm_groups WHERE name = ?').get(name) !== undefined;
  }

  groupSetEntry(grp: string, node: string, effect: string, constraints: unknown): void {
    this.db.prepare(`
      INSERT INTO perm_group_entries (grp, node, effect, constraints) VALUES (?, ?, ?, ?)
      ON CONFLICT(grp, node) DO UPDATE SET effect = excluded.effect, constraints = excluded.constraints
    `).run(grp, node, effect, constraints ? JSON.stringify(constraints) : null);
  }

  groupRemoveEntry(grp: string, node: string): boolean {
    return Number(this.db.prepare('DELETE FROM perm_group_entries WHERE grp = ? AND node = ?')
      .run(grp, node).changes) > 0;
  }

  groupAssign(userid: string, grp: string): void {
    this.db.prepare('INSERT OR IGNORE INTO perm_user_groups (userid, grp) VALUES (?, ?)').run(userid, grp);
  }

  groupUnassign(userid: string, grp: string): boolean {
    return Number(this.db.prepare('DELETE FROM perm_user_groups WHERE userid = ? AND grp = ?')
      .run(userid, grp).changes) > 0;
  }

  userGroups(userid: string): string[] {
    return (this.db.prepare(`
      SELECT g.name FROM perm_user_groups ug JOIN perm_groups g ON g.name = ug.grp
      WHERE ug.userid = ? ORDER BY g.weight DESC, g.name
    `).all(userid) as { name: string }[]).map((r) => r.name);
  }

  userEntries(userid: string): { node: string; effect: string; constraints: unknown }[] {
    return (this.db.prepare('SELECT * FROM perm_user_entries WHERE userid = ? ORDER BY node')
      .all(userid) as Record<string, unknown>[]).map((e) => ({
        node: String(e.node),
        effect: String(e.effect),
        constraints: e.constraints ? JSON.parse(String(e.constraints)) : null,
      }));
  }

  userSetEntry(userid: string, node: string, effect: string, constraints: unknown): void {
    this.db.prepare(`
      INSERT INTO perm_user_entries (userid, node, effect, constraints) VALUES (?, ?, ?, ?)
      ON CONFLICT(userid, node) DO UPDATE SET effect = excluded.effect, constraints = excluded.constraints
    `).run(userid, node, effect, constraints ? JSON.stringify(constraints) : null);
  }

  userRemoveEntry(userid: string, node: string): boolean {
    return Number(this.db.prepare('DELETE FROM perm_user_entries WHERE userid = ? AND node = ?')
      .run(userid, node).changes) > 0;
  }

  // The one answer everything consults. Returns the winning effect, where it
  // came from, and the winning allow's constraints for the caller to enforce.
  resolve(userid: string, node: string): {
    allowed: boolean;
    source: string;
    constraints: unknown;
  } {
    const sources: { label: string; entries: { node: string; effect: string; constraints: unknown }[] }[] = [];
    sources.push({ label: 'user', entries: this.userEntries(userid) });
    for (const grp of this.userGroups(userid)) {
      const entries = (this.db.prepare('SELECT * FROM perm_group_entries WHERE grp = ?')
        .all(grp) as Record<string, unknown>[]).map((e) => ({
          node: String(e.node),
          effect: String(e.effect),
          constraints: e.constraints ? JSON.parse(String(e.constraints)) : null,
        }));
      sources.push({ label: `group:${grp}`, entries });
    }
    const defaultGroup = this.db.prepare('SELECT name FROM perm_groups WHERE is_default = 1')
      .get() as { name: string } | undefined;
    if (defaultGroup) {
      const entries = (this.db.prepare('SELECT * FROM perm_group_entries WHERE grp = ?')
        .all(defaultGroup.name) as Record<string, unknown>[]).map((e) => ({
          node: String(e.node),
          effect: String(e.effect),
          constraints: e.constraints ? JSON.parse(String(e.constraints)) : null,
        }));
      sources.push({ label: `group:${defaultGroup.name}`, entries });
    }

    for (const source of sources) {
      let best: { specificity: number; effect: string; constraints: unknown } | null = null;
      for (const entry of source.entries) {
        const spec = nodeMatch(entry.node, node);
        if (spec === null) continue;
        if (
          best === null ||
          spec > best.specificity ||
          (spec === best.specificity && entry.effect === 'deny')
        ) {
          best = { specificity: spec, effect: entry.effect, constraints: entry.constraints };
        }
      }
      if (best) {
        return { allowed: best.effect === 'allow', source: source.label, constraints: best.constraints };
      }
    }

    const registered = this.db.prepare('SELECT default_effect FROM perm_nodes WHERE node = ?')
      .get(node) as { default_effect: string } | undefined;
    if (registered) {
      return { allowed: registered.default_effect === 'allow', source: 'default', constraints: null };
    }
    return { allowed: false, source: 'unregistered', constraints: null };
  }

  // Highest-weight group with a tag among the player's groups — the [ROLE].
  roleTag(userid: string): string | null {
    const row = this.db.prepare(`
      SELECT g.tag FROM perm_user_groups ug JOIN perm_groups g ON g.name = ug.grp
      WHERE ug.userid = ? AND g.tag != '' ORDER BY g.weight DESC LIMIT 1
    `).get(userid) as { tag: string } | undefined;
    if (row) return row.tag;
    const dflt = this.db.prepare("SELECT tag FROM perm_groups WHERE is_default = 1 AND tag != ''")
      .get() as { tag: string } | undefined;
    return dflt?.tag ?? null;
  }

  // ── locations ──────────────────────────────────────────────────────────────
  locationSave(name: string, x: number, y: number, z: number, source: string): void {
    this.db.prepare(`
      INSERT INTO locations (name, x, y, z, source, updated_at) VALUES (?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(name) DO UPDATE SET
        x = excluded.x, y = excluded.y, z = excluded.z,
        source = excluded.source, updated_at = excluded.updated_at
    `).run(name, x, y, z, source);
  }

  locations(): { name: string; x: number; y: number; z: number; source: string }[] {
    const rows = this.db.prepare('SELECT * FROM locations ORDER BY source, name').all() as
      Record<string, unknown>[];
    return rows.map((r) => ({
      name: String(r.name),
      x: Number(r.x),
      y: Number(r.y),
      z: Number(r.z),
      source: String(r.source),
    }));
  }

  locationDelete(name: string): boolean {
    return Number(this.db.prepare('DELETE FROM locations WHERE name = ?').run(name).changes) > 0;
  }

  // Every player that currently resolves to a role tag — the in-game prefix
  // file is generated from this.
  rolesForAll(): { userid: string; tag: string }[] {
    const out: { userid: string; tag: string }[] = [];
    const rows = this.db.prepare('SELECT userid FROM players').all() as { userid: string }[];
    for (const row of rows) {
      const tag = this.roleTag(String(row.userid));
      if (tag) out.push({ userid: String(row.userid), tag });
    }
    return out;
  }

  // ── options ────────────────────────────────────────────────────────────────
  optionGet(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM bridge_options WHERE key = ?').get(key) as
      { value: string } | undefined;
    return row?.value ?? null;
  }

  optionSet(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO bridge_options (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  // ── audit ──────────────────────────────────────────────────────────────────
  audit(actor: string, type: string, target: string | null, ok: boolean, detail: string): void {
    this.db.prepare(
      'INSERT INTO audit (at, actor, type, target, ok, detail) VALUES (unixepoch(), ?, ?, ?, ?, ?)',
    ).run(actor, type, target, ok ? 1 : 0, detail.slice(0, 300));
  }

  // ── migration from the pre-database registry file ──────────────────────────
  async migrateRegistry(jsonPath: string): Promise<void> {
    let raw: string;
    try {
      raw = await fs.readFile(jsonPath, 'utf8');
    } catch {
      return; // already migrated, or never existed
    }
    try {
      const old = JSON.parse(raw) as Record<
        string,
        { name?: string; firstSeen?: number; lastSeen?: number; joins?: number }
      >;
      for (const [userid, rec] of Object.entries(old)) {
        if (!/^[0-9A-F]{32}$/i.test(userid)) continue; // drop pre-fix malformed ids
        this.db.prepare(`
          INSERT INTO players (userid, name, first_seen, last_seen, joins)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(userid) DO NOTHING
        `).run(
          userid,
          rec.name ?? 'Unknown',
          rec.firstSeen ?? 0,
          rec.lastSeen ?? 0,
          rec.joins ?? 0,
        );
        // The old file only kept a first-seen date; synthesise its session so
        // firstEver stays true for the join that date belongs to.
        if (rec.firstSeen) {
          this.db.prepare('INSERT OR IGNORE INTO sessions (userid, joined_at, left_at) VALUES (?, ?, ?)')
            .run(userid, rec.firstSeen, rec.lastSeen ?? rec.firstSeen);
        }
      }
    } catch { /* unparseable old registry — nothing worth failing the boot for */ }
    await fs.rename(jsonPath, jsonPath + '.migrated').catch(() => {});
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

// Wildcard node matching. Returns a specificity (higher wins) or null:
// exact match beats "chatshop.*" beats "*".
function nodeMatch(pattern: string, node: string): number | null {
  if (pattern === node) return 1000;
  if (pattern === '*') return 0;
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -1); // keep the dot
    if (node.startsWith(prefix)) return pattern.split('.').length;
  }
  return null;
}
