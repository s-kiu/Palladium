#!/usr/bin/env node
// Generates every artifact derivable from bridge-capabilities.json:
//   - the agent's Lua capability table (hooks to register, param validation)
//   - the daemon's TypeScript capability table (validation, routing, schema)
//   - the capability reference in docs/
// Run from anywhere; paths resolve relative to this file. CI runs it and fails
// if the tree differs, so generated files can never drift from the manifest.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const manifest = JSON.parse(readFileSync(join(HERE, 'bridge-capabilities.json'), 'utf8'));

const HEADER = 'Generated from packages/shared/bridge-capabilities.json — do not edit. Regenerate: node packages/shared/generate.mjs';
const caps = manifest.capabilities;
const luaStr = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// ── agent table ──────────────────────────────────────────────────────────────
// Only what the agent runtime needs: its hooks and its action param specs.
function luaParam(name, p) {
  const parts = [`name = ${luaStr(name)}`, `kind = ${luaStr(p.type)}`];
  if (p.required) parts.push('required = true');
  if (p.min !== undefined) parts.push(`min = ${p.min}`);
  if (p.max !== undefined) parts.push(`max = ${p.max}`);
  if (p.maxLen !== undefined) parts.push(`max_len = ${p.maxLen}`);
  if (p.default !== undefined) {
    parts.push(`default = ${typeof p.default === 'string' ? luaStr(p.default) : p.default}`);
  }
  return `{ ${parts.join(', ')} }`;
}

const luaEvents = caps
  .filter((c) => c.kind === 'event' && c.runtime === 'agent' && c.source?.hook)
  .map((c) => `    { type = ${luaStr(c.type)}, hook = ${luaStr(c.source.hook)} },`);

const luaActions = caps
  .filter((c) => (c.kind === 'action' || c.kind === 'query') && c.runtime === 'agent')
  .map((c) => {
    const params = Object.entries(c.params ?? {}).map(([n, p]) => `            ${luaParam(n, p)},`);
    // The agent needs to know whether an action can run without a player, so
    // targeting travels with the params rather than being inferred from names.
    const head = [];
    if (c.target) head.push(`            target = ${luaStr(c.target)},\n`);
    if (c.targetOptional) head.push('            target_optional = true,\n');
    // The agent audits writes, so which calls change the game travels too.
    if (c.scope) head.push(`            scope = ${luaStr(c.scope)},\n`);
    return `        [${luaStr(c.type)}] = {\n${head.join('')}            params = {\n${params.join('\n')}\n            },\n        },`;
  });

// The engine's CharacterID is exact — "Sheepball" spawns nothing, and the
// English name "Lamball" is not an id at all. Both spellings of every known
// pal map to the id the engine wants, lowercased for the lookup.
const palsData = JSON.parse(readFileSync(join(ROOT, 'packages/shared/game-data/pals.json'), 'utf8'));
const speciesMap = new Map();
for (const pal of palsData) {
  if (pal.variant === 'normal' || !speciesMap.has(pal.id.toLowerCase())) {
    speciesMap.set(pal.id.toLowerCase(), pal.id);
  }
  const name = (pal.name ?? '').toLowerCase();
  if (name && (pal.variant === 'normal' || !speciesMap.has(name))) {
    speciesMap.set(name, pal.id);
  }
}
const luaSpecies = [...speciesMap.entries()]
  .sort(([a], [b]) => (a < b ? -1 : 1))
  .map(([key, id]) => `        [${luaStr(key)}] = ${luaStr(id)},`);

const lua = `-- ${HEADER}
return {
    envelope = ${manifest.envelope},
    events = {
${luaEvents.join('\n')}
    },
    actions = {
${luaActions.join('\n')}
    },
    species = {
${luaSpecies.join('\n')}
    },
}
`;

// ── daemon table ─────────────────────────────────────────────────────────────
const ts = `// ${HEADER}
export type ParamType = 'string' | 'int' | 'number' | 'bool' | 'item_id' | 'subject' | 'json';

export interface ParamSpec {
  type: ParamType;
  required?: boolean;
  picker?: string;
  optional?: boolean;
  enriched?: boolean;
  min?: number;
  max?: number;
  maxLen?: number;
  default?: string | number | boolean;
}

export interface Capability {
  type: string;
  kind: 'event' | 'action' | 'query';
  runtime: 'agent' | 'daemon' | 'game-rest';
  group?: 'player' | 'pals' | 'world' | 'permissions' | 'agent';
  subject?: string;
  target?: string;
  targetOptional?: boolean;
  source?: { hook: string };
  since: string;
  stability: 'stable' | 'experimental' | 'deprecated';
  scope: 'read' | 'write';
  summary: string;
  params?: Record<string, ParamSpec>;
  data?: Record<string, ParamSpec>;
  returns?: Record<string, string>;
  errors?: string[];
}

export const ENVELOPE_VERSION = ${manifest.envelope};

export const CAPABILITIES: Capability[] = ${JSON.stringify(caps, null, 2)};

export const ACTIONS = new Map(
  CAPABILITIES.filter((c) => c.kind !== 'event').map((c) => [c.type, c]),
);
`;

// ── docs ─────────────────────────────────────────────────────────────────────
function fieldTable(fields, isParams) {
  const rows = Object.entries(fields ?? {});
  if (!rows.length) return isParams ? '_none_' : '_none_';
  return rows
    .map(([n, p]) => {
      const bits = [`\`${n}\``, p.type];
      if (p.required) bits.push('required');
      if (p.default !== undefined) bits.push(`default ${JSON.stringify(p.default)}`);
      if (p.min !== undefined || p.max !== undefined) bits.push(`${p.min ?? ''}…${p.max ?? ''}`);
      if (p.enriched) bits.push('HTTP door only');
      if (p.optional) bits.push('optional');
      return bits.join(' · ');
    })
    .join('<br>');
}

const byNamespace = new Map();
for (const c of caps) {
  const ns = c.type.split('.')[0];
  if (!byNamespace.has(ns)) byNamespace.set(ns, []);
  byNamespace.get(ns).push(c);
}

// The chat word for a capability: the part after the dot when no other
// capability ends the same way, the full name otherwise — the same rule the
// agent applies at runtime.
const shortCounts = new Map();
for (const c of caps) {
  if (c.kind === 'event') continue;
  const short = c.type.includes('.') ? c.type.split('.').slice(1).join('.') : c.type;
  shortCounts.set(short, (shortCounts.get(short) ?? 0) + 1);
}
function chatWord(c) {
  if (c.kind === 'event') return '—';
  const short = c.type.includes('.') ? c.type.split('.').slice(1).join('.') : c.type;
  return `\`!${shortCounts.get(short) === 1 ? short : c.type}\``;
}

let md = `# Bridge capability reference

<!-- ${HEADER} -->

Envelope version ${manifest.envelope}. Every message is
\`{v, id?, at, kind, type, subject?, data}\`; results add \`ok\` and \`error\`.
Stability: **stable** shapes only ever gain fields; **experimental** may change
or vanish. \`GET /api/bridge/schema\` reports this table merged with what is
actually live on the running server.

Every action and query is also a chat command under the word in the Chat
column, gated by a permission node of the same name. Chat accepts \`key=value\`
or positional arguments matched to the declared parameters in order, \`@me\`
for the caller and \`@Name\` for an online player; \`!commands\` lists what the
caller may use and \`?<command>\` explains one. The same call is
\`POST /api/bridge/call\` over HTTP and \`pal.call(type, …)\` from a mod — one
schema drives all three surfaces.
`;

for (const [ns, list] of byNamespace) {
  md += `\n## ${ns}.*\n\n| Type | Chat | Kind | Runtime | Stability | Since | Fields | Summary |\n|---|---|---|---|---|---|---|---|\n`;
  for (const c of list) {
    const fields = c.kind === 'event' ? fieldTable(c.data, false) : fieldTable(c.params, true);
    md += `| \`${c.type}\` | ${chatWord(c)} | ${c.kind} | ${c.runtime} | ${c.stability} | ${c.since} | ${fields} | ${c.summary} |\n`;
  }
}

// ── write ────────────────────────────────────────────────────────────────────
// The script-mod SDK gets the same list, so `pal.player.give_item(…)` in a
// script mod is the same name as in a Lua mod, in chat and over HTTP — and a
// verb that is not a capability is a TypeError there rather than a round trip.
const sdk = `// ${HEADER}
export const capabilities = ${JSON.stringify(
  Object.fromEntries(
    caps
      .filter((c) => c.kind !== 'event')
      .map((c) => [c.type, { target: c.target ?? null, scope: c.scope ?? 'read' }]),
  ),
  null,
  2,
)};

export const events = ${JSON.stringify(caps.filter((c) => c.kind === 'event').map((c) => c.type), null, 2)};
`;

const outputs = [
  [join(ROOT, 'mods/Palladium/Scripts/generated/capabilities.lua'), lua],
  [join(ROOT, 'packages/daemon/src/generated/capabilities.ts'), ts],
  [join(ROOT, 'docs/bridge-reference.md'), md],
  [join(ROOT, 'packages/mod-sdk/generated/capabilities.mjs'), sdk],
];
for (const [path, content] of outputs) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log('wrote', path.slice(ROOT.length + 1));
}
