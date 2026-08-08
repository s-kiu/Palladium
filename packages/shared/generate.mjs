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
// ── editor types ─────────────────────────────────────────────────────────────
// The same manifest that drives the runtimes describes them to an editor:
// TypeScript declarations for script mods, LuaLS annotations for Lua mods.
// Neither is loaded at runtime — they exist so that typing `pal.player.` in a
// mod offers the real capabilities, with the real parameters, and says so when
// one is misspelt.
const TS_TYPE = {
  int: 'number', number: 'number', bool: 'boolean', string: 'string',
  item_id: 'string', json: 'unknown', subject: 'Subject', 'string|null': 'string | null',
};
const LUA_TYPE = {
  int: 'integer', number: 'number', bool: 'boolean', string: 'string',
  item_id: 'string', json: 'table', subject: 'PalSubject', 'string|null': 'string|nil',
};
const tsType = (t) => TS_TYPE[t] ?? 'unknown';
const luaType = (t) => LUA_TYPE[t] ?? 'any';
const pascal = (s) => s.split(/[._]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
const callable = caps.filter((c) => c.kind !== 'event');
const eventCaps = caps.filter((c) => c.kind === 'event');
const byNs = new Map();
for (const c of callable) {
  const [ns, verb] = c.type.split('.');
  if (!byNs.has(ns)) byNs.set(ns, []);
  byNs.get(ns).push({ ...c, verb });
}
const doc = (c) => `  /** ${c.summary}${c.stability === 'experimental' ? ' _(experimental)_' : ''} */`;

let dts = `// ${HEADER}\n
/** Who or what an event is about. */
export interface Subject {
  kind: string;
  id: string;
  name?: string;
}

/** What every call answers with. Game-level failure is \`ok: false\`, not a throw. */
export interface Envelope<T> {
  ok: boolean;
  error?: string;
  data: T;
  id?: string;
  at?: number;
  type?: string;
}
`;

for (const c of callable) {
  const name = pascal(c.type);
  const params = Object.entries(c.params ?? {});
  dts += `\n/** ${c.summary} */\nexport interface ${name}Params {\n`;
  dts += params.length
    ? params.map(([n, p]) => `  ${n}${p.required ? '' : '?'}: ${tsType(p.type)};`).join('\n') + '\n'
    : '';
  dts += `}\n`;
  const returns = Object.entries(c.returns ?? {});
  dts += `export interface ${name}Result {\n`;
  dts += returns.map(([n, t]) => `  ${n}: ${tsType(t)};`).join('\n') + (returns.length ? '\n' : '');
  dts += `}\n`;
}

dts += `\n/** Every capability, under the name the manifest gives it. */\nexport interface Capabilities {\n`;
for (const [ns, list] of byNs) {
  dts += `  ${ns}: {\n`;
  for (const c of list) {
    const name = pascal(c.type);
    const optional = Object.values(c.params ?? {}).every((p) => !p.required) ? '?' : '';
    dts += `${doc(c).replace(/^/gm, '  ')}\n`;
    // Only a call that names a player takes an id, and only one whose target
    // is optional may skip it. Anything else starts at the parameters, which
    // is exactly what the runtimes accept.
    if (c.target === 'player') {
      dts += `    ${c.verb}(target: string, params${optional}: ${name}Params): Promise<Envelope<${name}Result>>;\n`;
      if (c.targetOptional) {
        dts += `    ${c.verb}(params${optional}: ${name}Params): Promise<Envelope<${name}Result>>;\n`;
        dts += `    ${c.verb}(target: null, params${optional}: ${name}Params): Promise<Envelope<${name}Result>>;\n`;
      }
    } else {
      dts += `    ${c.verb}(params${optional}: ${name}Params): Promise<Envelope<${name}Result>>;\n`;
    }
  }
  dts += `  };\n`;
}
dts += `}\n`;

dts += `\n/** The payload each event carries, by type. */\nexport interface EventData {\n`;
for (const c of eventCaps) {
  const fields = Object.entries(c.data ?? {});
  dts += `  ${JSON.stringify(c.type)}: {${fields.length ? '\n' + fields.map(([n, f]) => `    ${n}: ${tsType(f.type)};`).join('\n') + '\n  ' : ''}};\n`;
}
dts += `}\n\nexport type EventType = keyof EventData;\n\n/** An event as a handler receives it. */\nexport interface PalEvent<T extends EventType = EventType> {\n  v: number;\n  at: number;\n  kind: 'event';\n  type: T;\n  subject: Subject;\n  data: EventData[T];\n}\n`;

// ── LuaLS annotations ────────────────────────────────────────────────────────
let luadef = `---@meta\n-- ${HEADER}\n--\n-- Editor types only: lua-language-server reads this and offers the real\n-- capabilities while a mod is being written. Nothing loads it at runtime.\n\n---@class PalSubject\n---@field kind string\n---@field id string\n---@field name string|nil\n\n---@class PalEvent\n---@field type string\n---@field at integer\n---@field subject PalSubject\n---@field data table\n`;

for (const c of callable) {
  const name = pascal(c.type);
  luadef += `\n---@class ${name}Params\n`;
  for (const [n, p] of Object.entries(c.params ?? {})) {
    luadef += `---@field ${n}${p.required ? '' : '?'} ${luaType(p.type)}${p.type === 'item_id' ? ' # an item id, not the shown name' : ''}\n`;
  }
}
for (const [ns, list] of byNs) {
  luadef += `\n---@class Pal${pascal(ns)}\n`;
  for (const c of list) {
    const name = pascal(c.type);
    const done = 'done?: fun(ok: boolean, err: string|nil, data: table)';
    const args = c.target === 'player'
      ? `target: string${c.targetOptional ? '|nil' : ''}, params: ${name}Params, ${done}`
      : `params: ${name}Params, ${done}`;
    luadef += `---@field ${c.verb} fun(${args}) # ${c.summary.replace(/\n/g, ' ')}\n`;
  }
}
luadef += `\n---@class Pal\n---@field name string\n---@field settings table\n`;
for (const ns of byNs.keys()) luadef += `---@field ${ns} Pal${pascal(ns)}\n`;
luadef += `---@field log fun(text: any)\n`;
luadef += `---@field call fun(action: string, userid: string|nil, params: table, done?: fun(ok: boolean, err: string|nil, data: table))\n`;
luadef += `---@field can fun(userid: string, node: string, params?: table): boolean\n`;
luadef += `---@field tag fun(userid: string, key: string): string|nil\n`;
luadef += `---@field set_tag fun(userid: string, key: string, value: any): boolean\n`;
luadef += `---@field delete_tag fun(userid: string, key: string): boolean\n`;
luadef += `---@field data fun(collection: string): table\n`;
luadef += `\n-- Event types this build publishes:\n`;
for (const c of eventCaps) {
  const fields = Object.entries(c.data ?? {}).map(([n, f]) => `${n}: ${luaType(f.type)}`).join(', ');
  luadef += `--   ${c.type}${fields ? ' — ' + fields : ''}\n`;
}

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
  [join(ROOT, 'packages/mod-sdk/generated/capabilities.d.ts'), dts],
  [join(ROOT, 'mods/Palladium/Scripts/generated/palladium.def.lua'), luadef],
];
for (const [path, content] of outputs) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log('wrote', path.slice(ROOT.length + 1));
}
