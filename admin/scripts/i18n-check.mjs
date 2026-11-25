// npm run i18n [-- --loose] : every t()/tn()/tx()/msg() text has a Latvian entry; lists JSX text and attributes
// that look untranslated. Exit code 1 when a translation is missing.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../src/', import.meta.url).pathname;
const dictDir = join(root, 'lib/i18n/lv');
const dict = new Map();
const clashes = [];
for (const f of readdirSync(dictDir).filter((f) => f.endsWith('.ts'))) {
  const mod = await import(join(dictDir, f));
  for (const [k, v] of Object.entries(Object.values(mod)[0])) {
    if (dict.has(k) && dict.get(k) !== v) clashes.push(`${k}\n    ${dict.get(k)}\n    ${v} (${f})`);
    dict.set(k, v);
  }
}

const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (!p.includes('/i18n')) walk(p); }
    else if (/\.(tsx?|ts)$/.test(f) && !f.endsWith('.d.ts') && !p.endsWith('lib/i18n.tsx')) files.push(p);
  }
})(root);

const STR = String.raw`'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|\x60((?:\\.|[^\x60\\])*)\x60`;
const call = new RegExp(String.raw`\b(t|tx|msg)\(\s*(?:${STR})`, 'g');
const plural = new RegExp(String.raw`\btn\([^,]+,\s*(?:${STR})\s*,\s*(?:${STR})`, 'g');
const unescape = (s) => s.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');

const missing = [], dynamic = [], used = new Set(), suspects = [];
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const rel = relative(root, file);
  const line = (i) => src.slice(0, i).split('\n').length;
  const check = (raw, isTpl, i) => {
    if (isTpl && raw.includes('${')) { dynamic.push(`${rel}:${line(i)}  ${raw.slice(0, 70)}`); return; }
    const key = unescape(raw);
    used.add(key);
    if (!dict.has(key)) missing.push(`${rel}:${line(i)}  ${key}`);
  };
  for (const m of src.matchAll(call)) check(m[2] ?? m[3] ?? m[4], m[4] !== undefined, m.index);
  for (const m of src.matchAll(plural)) {
    check(m[1] ?? m[2] ?? m[3], m[3] !== undefined, m.index);
    check(m[4] ?? m[5] ?? m[6], m[6] !== undefined, m.index);
  }
  if (file.endsWith('.tsx')) {
    // JSX text between tags, and plain-string UI attributes.
    for (const m of src.matchAll(/>\s*([^<>{}\n]*[A-Za-z]{2,}[^<>{}\n]*?)\s*(?=<|\{|\n)/g)) {
      const txt = m[1].trim();
      if (!txt || /^[\w.]+\s*=>|^[&|?:=]|\)\s*$|^[a-z]+\.[a-z]/.test(txt) || /^(\w+)$/.test(txt) && txt.length < 3) continue;
      const before = src.slice(Math.max(0, m.index - 1), m.index + 1);
      if (/[=]>$/.test(before) || /=>$/.test(src.slice(m.index - 2, m.index + 1))) continue;
      suspects.push(`${rel}:${line(m.index)}  text: ${txt.slice(0, 80)}`);
    }
    for (const m of src.matchAll(/\b(title|placeholder|aria-label|label|lead|caption|alt|what|hint|sub)=(["'])([^"'{}]*[A-Za-z]{2,}[^"'{}]*)\2/g)) {
      suspects.push(`${rel}:${line(m.index)}  ${m[1]}="${m[3].slice(0, 70)}"`);
    }
  }
}

const loose = process.argv.includes('--loose');
const unused = [...dict.keys()].filter((k) => !used.has(k));
const show = (title, list) => list.length && console.log(`\n${title} (${list.length})\n  ` + list.join('\n  '));
show('Missing Latvian', missing);
show('Built from pieces (use placeholders)', dynamic);
show('Different translations for the same text', clashes);
if (!loose) show('Possibly untranslated', suspects);
show('Unused entries', unused);
console.log(`\n${used.size} texts, ${dict.size} entries, ${missing.length} missing`);
process.exit(missing.length || dynamic.length || clashes.length ? 1 : 0);
