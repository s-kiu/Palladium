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
