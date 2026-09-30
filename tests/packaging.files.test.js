import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/** Every relative import reachable from src/main must live in a folder that electron-builder packages. */
const ROOT = path.resolve(__dirname, '..');
const config = fs.readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf8');
const packaged = [...config.matchAll(/^\s+-\s+"?(src\/[^/"]+)\/\*\*\/\*"?\s*$/gm)].map((m) => m[1]);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
}

describe('packaging', () => {
  it('packages every src/ folder imported from the main process', () => {
    const missing = new Set();
    for (const file of walk(path.join(ROOT, 'src/main'))) {
      // JSDoc `import('…')` type references are not runtime imports.
      const src = fs.readFileSync(file, 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
      for (const m of src.matchAll(/(?:from\s+|import\s*\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
        const rel = path.relative(ROOT, path.resolve(path.dirname(file), m[1])).split(path.sep);
        if (rel[0] !== 'src') continue;
        const top = `src/${rel[1]}`;
        if (!packaged.includes(top)) missing.add(`${top} (from ${path.relative(ROOT, file)})`);
      }
    }
    expect([...missing]).toEqual([]);
  });
});
