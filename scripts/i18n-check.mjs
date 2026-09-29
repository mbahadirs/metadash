#!/usr/bin/env node
/**
 * Translation completeness check (npm run i18n:check). For the renderer (src/renderer/locales) and the main process
 * (src/main/locales) it reports, per locale and namespace, compared with English:
 *   - missing keys (with % translated) and extra keys (not in English)
 *   - placeholder mismatches ({n} in English but not in the translation, or the reverse)
 *   - keys defined in more than one namespace (message namespaces share one keyspace)
 *   - keys used in code (t('…') / msg('…') / L('…')) that English does not define
 *   - with --unused: English keys no literal call site mentions (informational; many keys are built dynamically)
 * Exits non-zero for: en/tr gaps or extras, placeholder mismatches in any locale, duplicate keys, unknown used keys,
 * malformed files. Partial locales (de, es, …) only produce warnings for missing keys.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED = ['en', 'tr'];
/** Main-process namespaces read as separate documents (see src/main/locales/catalog.js). */
const DOCUMENT_NAMESPACES = new Set(['report', 'approval']);

export const SIDES = {
  renderer: { dir: 'src/renderer/locales', code: 'src/renderer', exts: ['.ts', '.tsx'], calls: [{ re: /\b(?:t|tr|tx)\(\s*'([a-z][a-z0-9_]*)'/g, scope: 'messages' }] },
  main: {
    dir: 'src/main/locales', code: 'src/main', exts: ['.js', '.cjs'],
    calls: [
      { re: /\b(?:msg|translate)\(\s*'([a-z][a-z0-9_]*)'/g, scope: 'messages' },
      { re: /\bL\(\s*'([a-z][a-z0-9_]*)'/g, scope: 'report', only: /(export\/|weeklyDigest)/ },
      { re: /\bm\(\s*'([a-z][a-z0-9_]*)'/g, scope: 'messages', only: /meta\/errors\.js$/ },
    ],
  },
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const sameSet = (a, b) => a.length === b.length && [...new Set(a)].every((x) => b.includes(x)) && [...new Set(b)].every((x) => a.includes(x));

export function localeCodes() {
  return readJson(path.join(ROOT, 'src/main/locales/index.json')).map((l) => l.code);
}

/** { lang: { ns: dict } } for one side; problems collects malformed files. */
export function loadSide(side, problems = []) {
  const base = path.join(ROOT, SIDES[side].dir);
  const out = {};
  for (const lang of fs.readdirSync(base).filter((d) => fs.statSync(path.join(base, d)).isDirectory())) {
    out[lang] = {};
    for (const f of fs.readdirSync(path.join(base, lang)).filter((x) => x.endsWith('.json'))) {
      try {
        const dict = readJson(path.join(base, lang, f));
        if (!dict || typeof dict !== 'object' || Array.isArray(dict)) throw new Error('not an object');
        for (const [k, v] of Object.entries(dict)) if (typeof v !== 'string') throw new Error(`"${k}" is not a string`);
        out[lang][f.slice(0, -5)] = dict;
      } catch (err) {
        problems.push(`${side}: ${lang}/${f}: ${err.message}`);
      }
    }
  }
  return out;
}

function walk(dir, exts, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'locales' && e.name !== 'node_modules') walk(p, exts, acc); } else if (exts.includes(path.extname(e.name))) acc.push(p);
  }
  return acc;
}

/** Literal keys used in code: [{ key, scope, file }]. */
export function usedKeys(side) {
  const cfg = SIDES[side];
  const out = [];
  for (const file of walk(path.join(ROOT, cfg.code), cfg.exts)) {
    const rel = path.relative(ROOT, file);
    const text = fs.readFileSync(file, 'utf8');
    for (const call of cfg.calls) {
      if (call.only && !call.only.test(rel)) continue;
      for (const m of text.matchAll(call.re)) out.push({ key: m[1], scope: call.scope, file: rel });
    }
  }
  return out;
}

const scopeOf = (side, ns) => (side === 'main' && DOCUMENT_NAMESPACES.has(ns) ? ns : 'messages');

/** Full report for one side: { errors: string[], warnings: string[], stats: { lang: pct } }. */
export function checkSide(side, { unused = false } = {}) {
  const errors = [];
  const warnings = [];
  const data = loadSide(side, errors);
  const en = data.en ?? {};
  const codes = localeCodes();
  const langs = [...new Set([...codes, ...Object.keys(data)])];
  const stats = {};

  for (const lang of langs) {
    if (!codes.includes(lang)) errors.push(`${side}: folder "${lang}" is not listed in src/main/locales/index.json`);
    if (!data[lang]) { errors.push(`${side}: locale "${lang}" has no folder`); continue; }
    if (lang === 'en') continue;
    const required = REQUIRED.includes(lang);
    let total = 0; let have = 0;
    for (const [ns, enDict] of Object.entries(en)) {
      const dict = data[lang][ns];
      if (!dict) { (required ? errors : warnings).push(`${side}: ${lang}/${ns}.json is missing`); }
      const d = dict ?? {};
      const missing = Object.keys(enDict).filter((k) => !(k in d));
      total += Object.keys(enDict).length; have += Object.keys(enDict).length - missing.length;
      if (missing.length && required) errors.push(`${side}: ${lang}/${ns}: ${missing.length} missing: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ', …' : ''}`);
      const extra = Object.keys(d).filter((k) => !(k in enDict));
      if (extra.length) (required ? errors : warnings).push(`${side}: ${lang}/${ns}: ${extra.length} extra (not in en): ${extra.slice(0, 10).join(', ')}`);
      for (const [k, v] of Object.entries(d)) {
        if (k in enDict && !sameSet(placeholders(enDict[k]), placeholders(v))) errors.push(`${side}: ${lang}/${ns}: "${k}" placeholders {${placeholders(v).join(',')}} ≠ en {${placeholders(enDict[k]).join(',')}}`);
      }
    }
    for (const ns of Object.keys(data[lang])) if (!en[ns]) errors.push(`${side}: ${lang}/${ns}.json has no English counterpart`);
    stats[lang] = total ? Math.floor((have / total) * 100) : 100;
  }

  const owner = new Map();
  for (const [ns, dict] of Object.entries(en)) {
    const scope = scopeOf(side, ns);
    for (const k of Object.keys(dict)) {
      const id = `${scope}:${k}`;
      if (owner.has(id)) errors.push(`${side}: key "${k}" is defined in both ${owner.get(id)} and ${ns}`);
      else owner.set(id, ns);
    }
  }

  const used = usedKeys(side);
  const defined = (scope, key) => owner.has(`${scope}:${key}`);
  for (const u of used) if (!defined(u.scope, u.key)) errors.push(`${side}: ${u.file} uses "${u.key}" (${u.scope}), which en does not define`);
  if (unused) {
    const mentioned = new Set(used.map((u) => `${u.scope}:${u.key}`));
    const never = [...owner.keys()].filter((id) => !mentioned.has(id));
    warnings.push(`${side}: ${never.length} keys without a literal call site (may be built dynamically): ${never.slice(0, 40).map((id) => id.split(':')[1]).join(', ')}${never.length > 40 ? ', …' : ''}`);
  }
  return { errors: [...new Set(errors)], warnings, stats };
}

function main() {
  const unused = process.argv.includes('--unused');
  let failed = false;
  for (const side of Object.keys(SIDES)) {
    const { errors, warnings, stats } = checkSide(side, { unused });
    console.log(`\n${side}: ${Object.entries(stats).map(([l, p]) => `${l} ${p}%`).join(' · ')}`);
    for (const w of warnings) console.log(`  warn  ${w}`);
    for (const e of errors) console.log(`  ERROR ${e}`);
    failed ||= errors.length > 0;
  }
  console.log(failed ? '\ni18n:check failed' : '\ni18n:check ok');
  process.exit(failed ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
