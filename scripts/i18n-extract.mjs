#!/usr/bin/env node
/**
 * One-off converter (v2.0 chunk A): turns the pre-2.0 tuple dictionaries into per-locale JSON namespace files.
 *
 * ALREADY RUN — kept for reference. The source dictionaries it reads were replaced by thin loaders afterwards, so to
 * rerun it point --src at a checkout of v1.5 (e.g. `git worktree add ../md-v15 v1.5.0`):
 *
 *   node scripts/i18n-extract.mjs --src ../md-v15 [--out .] [--force]
 *
 * The three pre-2.0 tuple formats have different orders:
 *   renderer lib/i18n.ts + lib/i18n/*.ts   { key: [tr, en] }
 *   main export/reportI18n.js              { key: [tr, en] }
 *   main i18n.js + i18n/*.js               { key: [en, tr] }   ← reversed
 *
 * Spread order decided which duplicate won at runtime (later spreads override earlier ones); the script keeps each
 * duplicate only in the namespace whose value was actually used, and prints what it dropped.
 * Strings that were not in tuple dictionaries (meta/errors.js hints, weeklyDigest, lifecycle and approval labels) were
 * moved by hand into errors.json / report.json / background.json / approval.json.
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const SRC = path.resolve(opt('--src', '.'));
const OUT = path.resolve(opt('--out', '.'));
const FORCE = args.includes('--force');

/** Source dictionaries in runtime merge order (index 0 = spread first = loses on duplicates). */
const RENDERER = [
  { file: 'src/renderer/lib/i18n/planner.ts', name: 'plannerDict', ns: 'planner' },
  { file: 'src/renderer/lib/i18n/background.ts', name: 'backgroundDict', ns: 'background' },
  { file: 'src/renderer/lib/i18n/studio.ts', name: 'studioDict', ns: 'studio' },
  { file: 'src/renderer/lib/i18n/studio.voice.ts', name: 'studioVoiceDict', ns: 'studio.voice' },
  { file: 'src/renderer/lib/i18n/studio.ideas.ts', name: 'studioIdeasDict', ns: 'studio.ideas' },
  { file: 'src/renderer/lib/i18n/studio.inbox.ts', name: 'studioInboxDict', ns: 'studio.inbox' },
  { file: 'src/renderer/lib/i18n.ts', name: 'dict', ns: 'core' }, // core keys were written after the spreads
].map((s) => ({ ...s, order: ['tr', 'en'] }));

const MAIN = [
  { file: 'src/main/i18n.js', name: 'CORE', ns: 'messages' },
  { file: 'src/main/i18n/planner.js', name: 'PLANNER_MESSAGES', ns: 'planner' },
  { file: 'src/main/i18n/publishing.js', name: 'PUBLISHING_MESSAGES', ns: 'publishing' },
  { file: 'src/main/i18n/background.js', name: 'BACKGROUND_MESSAGES', ns: 'background' },
  { file: 'src/main/i18n/studio.js', name: 'STUDIO_MESSAGES', ns: 'studio' },
  { file: 'src/main/i18n/studio.voice.js', name: 'STUDIO_VOICE_MESSAGES', ns: 'studio.voice' },
  { file: 'src/main/i18n/studio.ideas.js', name: 'STUDIO_IDEAS_MESSAGES', ns: 'studio.ideas' },
  { file: 'src/main/i18n/studio.inbox.js', name: 'STUDIO_INBOX_MESSAGES', ns: 'studio.inbox' },
].map((s) => ({ ...s, order: ['en', 'tr'] }));

const REPORT = [{ file: 'src/main/export/reportI18n.js', name: 'D', ns: 'report', order: ['tr', 'en'] }];

/**
 * Evaluates the object literal assigned to `const <name> = {` (closing brace at column 0). Spread lines are removed:
 * spreads were how feature dictionaries were merged, and each of those is extracted on its own.
 */
function readDict(src) {
  const text = fs.readFileSync(path.join(SRC, src.file), 'utf8');
  const start = text.search(new RegExp(`(?:export\\s+)?const\\s+${src.name}\\s*=\\s*\\{`));
  if (start < 0) throw new Error(`${src.file}: const ${src.name} not found`);
  const open = text.indexOf('{', start);
  const close = text.slice(open).search(/\n\}( as const)?;/);
  if (close < 0) throw new Error(`${src.file}: end of ${src.name} not found`);
  const body = text.slice(open, open + close + 2).split('\n').filter((l) => !/^\s*\.\.\.\w+,\s*$/.test(l)).join('\n');
  // eslint-disable-next-line no-new-func -- trusted repository source, run by hand.
  return new Function(`return (${body});`)();
}

/** { ns: { lang: { key: string } } } with duplicates resolved to the runtime winner. */
function convert(sources) {
  const read = sources.map((s) => ({ ...s, dict: readDict(s) }));
  const winner = new Map();
  for (const s of read) for (const k of Object.keys(s.dict)) {
    if (winner.has(k) && winner.get(k) !== s.ns) console.warn(`duplicate key "${k}": ${winner.get(k)} → ${s.ns} (kept in ${s.ns})`);
    winner.set(k, s.ns);
  }
  const out = {};
  for (const s of read) {
    out[s.ns] = { en: {}, tr: {} };
    for (const [k, tuple] of Object.entries(s.dict)) {
      if (winner.get(k) !== s.ns) continue;
      if (!Array.isArray(tuple) || tuple.length !== 2) throw new Error(`${s.file}: ${k} is not a [a, b] tuple`);
      s.order.forEach((lang, i) => { out[s.ns][lang][k] = tuple[i]; });
    }
  }
  return out;
}

function write(dir, namespaces) {
  for (const [ns, byLang] of Object.entries(namespaces)) {
    for (const lang of ['en', 'tr', 'de', 'es']) {
      const file = path.join(OUT, dir, lang, `${ns}.json`);
      if (fs.existsSync(file) && !FORCE) { console.log(`skip ${path.relative(OUT, file)} (exists; --force overwrites)`); continue; }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(byLang[lang] ?? {}, null, 2)}\n`);
      console.log(`wrote ${path.relative(OUT, file)} (${Object.keys(byLang[lang] ?? {}).length} keys)`);
    }
  }
}

write('src/renderer/locales', convert(RENDERER));
write('src/main/locales', { ...convert(MAIN), ...convert(REPORT) });
