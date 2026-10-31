// Static check of the Maestro flows (no device needed): every YAML parses, every `id:` a flow
// uses is in TESTIDS.md (contract, wave-2 or proposed; proposed ones are listed as dry), every
// top-level flow has the app id and tags, and no flow takes a screenshot or recording.
//   node apps/mobile/e2e/scripts/check-flows.mjs
// Uses js-yaml, which the root ESLint already brings in; no new dependency.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { loadAll } from 'js-yaml';

const e2e = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const flowsDir = path.join(e2e, 'flows');
const out = s => process.stdout.write(s + '\n');

// TESTIDS.md rows: | `id` | screen | status [| needed by] |
const ids = new Map();
for (const line of readFileSync(path.join(e2e, 'TESTIDS.md'), 'utf8').split('\n')) {
  const m = /^\| `([^`]+)` \|.*\| (contract|wave-2|proposed) \|/.exec(line);
  if (m) ids.set(m[1], m[2]);
}
const known = [...ids.keys()];
const concrete = id => id.replace(/<[a-z]+>/g, 'x1'); // msg.<id> → msg.x1

function* walk(dir) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name);
    if (name.isDirectory()) yield* walk(full);
    else if (name.name.endsWith('.yaml')) yield full;
  }
}

function* nodes(v) {
  if (Array.isArray(v)) for (const x of v) yield* nodes(x);
  else if (v && typeof v === 'object') {
    yield v;
    for (const x of Object.values(v)) yield* nodes(x);
  }
}

const FORBIDDEN = new Set(['takeScreenshot', 'startRecording', 'stopRecording']);
const problems = [];
const dry = new Map();
let flows = 0;

for (const file of walk(flowsDir)) {
  const rel = path.relative(e2e, file);
  let docs;
  try {
    docs = loadAll(readFileSync(file, 'utf8'));
  } catch (e) {
    problems.push(`${rel}: YAML does not parse: ${e.message.split('\n')[0]}`);
    continue;
  }
  const [header, commands] = docs.length === 2 ? docs : [null, docs[0]];
  const top = !rel.includes(`${path.sep}_common${path.sep}`);
  if (!header || header.appId !== 'io.onepeek.app') problems.push(`${rel}: header must set appId: io.onepeek.app`);
  if (top) {
    flows++;
    if (!header?.name || header.name !== path.basename(file, '.yaml')) problems.push(`${rel}: name must equal the file name`);
    if (!Array.isArray(header?.tags) || !header.tags.some(t => t === 'ios' || t === 'android')) problems.push(`${rel}: tags must include ios and/or android`);
  }
  if (!Array.isArray(commands)) {
    problems.push(`${rel}: the command list is missing`);
    continue;
  }
  for (const node of nodes(commands)) {
    for (const key of Object.keys(node)) if (FORBIDDEN.has(key)) problems.push(`${rel}: ${key} is forbidden (secret content must never be captured)`);
    if (typeof node.id !== 'string') continue;
    const id = node.id;
    const isPattern = /[\\()|+*?[\]]/.test(id);
    const matches = isPattern ? known.filter(k => new RegExp(`^(?:${id})$`).test(concrete(k))) : known.includes(id) ? [id] : [];
    if (matches.length === 0) problems.push(`${rel}: id "${id}" is not in TESTIDS.md`);
    for (const k of matches) if (ids.get(k) === 'proposed') dry.set(k, [...(dry.get(k) ?? []), rel]);
  }
}

out(`${flows} flows, ${known.length} ids in TESTIDS.md (${known.filter(k => ids.get(k) === 'proposed').length} proposed)`);
if (dry.size) {
  out('dry steps (proposed ids, lead to decide):');
  for (const [k, files] of [...dry].sort()) out(`  ${k}: ${[...new Set(files)].join(', ')}`);
}
if (problems.length) {
  out('problems:');
  for (const p of problems) out(`  ${p}`);
  process.exit(1);
}
out('flows OK');
