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
    return `        [${luaStr(c.type)}] = {\n${head.join('')}            params = {\n${params.join('\n')}\n            },\n        },`;
  });

const lua = `-- ${HEADER}
return {
    envelope = ${manifest.envelope},
    events = {
${luaEvents.join('\n')}
    },
    actions = {
${luaActions.join('\n')}
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

let md = `# Bridge capability reference

<!-- ${HEADER} -->

Envelope version ${manifest.envelope}. Every message is
\`{v, id?, at, kind, type, subject?, data}\`; results add \`ok\` and \`error\`.
Stability: **stable** shapes only ever gain fields; **experimental** may change
or vanish. \`GET /api/bridge/schema\` reports this table merged with what is
actually live on the running server.
`;

for (const [ns, list] of byNamespace) {
  md += `\n## ${ns}.*\n\n| Type | Kind | Runtime | Stability | Since | Fields | Summary |\n|---|---|---|---|---|---|---|\n`;
  for (const c of list) {
    const fields = c.kind === 'event' ? fieldTable(c.data, false) : fieldTable(c.params, true);
    md += `| \`${c.type}\` | ${c.kind} | ${c.runtime} | ${c.stability} | ${c.since} | ${fields} | ${c.summary} |\n`;
  }
}

// ── write ────────────────────────────────────────────────────────────────────
const outputs = [
  [join(ROOT, 'mods/Palladium/Scripts/generated/capabilities.lua'), lua],
  [join(ROOT, 'packages/daemon/src/generated/capabilities.ts'), ts],
  [join(ROOT, 'docs/bridge-reference.md'), md],
];
for (const [path, content] of outputs) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log('wrote', path.slice(ROOT.length + 1));
}
