// Static accessibility check of the app's screens and components (no device, no jest):
// every <Pressable>, <TouchableOpacity>, <TouchableHighlight>, <TouchableWithoutFeedback> and
// react-native <Button> opening tag under apps/mobile/app and apps/mobile/components must carry an
// accessibilityLabel (or aria-label) and an accessibilityRole (or role). The project's own
// components/Button.tsx sets both from `title`, so a <Button> from '../components/Button' is only
// flagged when it has neither `title` nor `accessibilityLabel`.
//   node apps/mobile/e2e/scripts/check-a11y.mjs            # report, exit 0
//   node apps/mobile/e2e/scripts/check-a11y.mjs --strict   # exit 1 when anything is flagged
// A tag that spreads props ({...rest}) is listed separately as "cannot tell": the label may arrive
// through the spread, so a human reads it. Nothing here edits app code: the list goes to mobile-ui.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const mobile = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const ROOTS = ['app', 'components'].map(d => path.join(mobile, d));
const TAGS = ['Pressable', 'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback', 'Button'];
const strict = process.argv.includes('--strict');
const out = s => process.stdout.write(s + '\n');

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') yield* walk(full); }
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) yield full;
  }
}

/** The opening tag starting at `start` (`<Tag`), up to and including its `>` or `/>`, respecting {…} and strings. */
function openingTag(src, start) {
  let i = start, depth = 0, quote = null;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (quote) { if (ch === quote && src[i - 1] !== '\\') quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '>' && depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;
const has = (tag, re) => re.test(tag);

const findings = [];   // missing label and/or role
const unsure = [];     // spread props, cannot tell statically
let scanned = 0, files = 0;

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const src = readFileSync(file, 'utf8');
    const rel = path.relative(mobile, file);
    files++;
    // Is <Button> in this file the project's wrapper (sets role + label from title) or react-native's?
    const rnButton = /import\s*\{[^}]*\bButton\b[^}]*\}\s*from\s*'react-native'/.test(src);
    const re = new RegExp(`<(${TAGS.join('|')})(?=[\\s/>])`, 'g');
    let m;
    while ((m = re.exec(src))) {
      const tag = openingTag(src, m.index);
      const name = m[1];
      const line = lineOf(src, m.index);
      scanned++;
      const label = has(tag, /\b(accessibilityLabel|aria-label)\s*=/);
      const role = has(tag, /\b(accessibilityRole|role)\s*=/);
      const title = has(tag, /\btitle\s*=/);
      const testID = /\btestID\s*=\s*(?:"([^"]*)"|\{`([^`]*)`\}|\{([^}]*)\})/.exec(tag);
      const id = testID ? (testID[1] ?? testID[2] ?? testID[3]) : null;
      const spread = /\{\s*\.\.\./.test(tag);
      const hidden = /\baccessible\s*=\s*\{\s*false\s*\}|importantForAccessibility\s*=\s*["']no/.test(tag);
      if (name === 'Button' && !rnButton) {
        // Project Button: label defaults to title, role is fixed to "button".
        if (!title && !label) findings.push({ rel, line, name, id, missing: ['accessibilityLabel (no title either)'] });
        continue;
      }
      const missing = [];
      if (!label) missing.push('accessibilityLabel');
      if (!role) missing.push('accessibilityRole');
      if (missing.length === 0 || hidden) continue;
      (spread ? unsure : findings).push({ rel, line, name, id, missing });
    }
  }
}

const fmt = f => `  ${f.rel}:${f.line} <${f.name}>${f.id ? ` testID=${f.id}` : ''}: missing ${f.missing.join(', ')}`;
out(`${files} files, ${scanned} pressable elements scanned under app/ and components/`);
if (findings.length) { out(`missing label and/or role (${findings.length}):`); findings.forEach(f => out(fmt(f))); }
if (unsure.length) { out(`cannot tell statically, props are spread (${unsure.length}):`); unsure.forEach(f => out(fmt(f))); }
if (!findings.length && !unsure.length) out('a11y OK');
if (strict && findings.length) process.exit(1);
