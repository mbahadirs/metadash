import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { GRAPH_VERSION as SHARED_GRAPH_VERSION } from '../src/shared/publish/graph.js';
import { GRAPH_VERSION } from '../src/main/meta/client.js';
import { threadsKey as sharedThreadsKey } from '../src/shared/publish/threads.js';
import { threadsKey } from '../src/main/providers/threads/mappers.js';
import desktopInstagram from '../src/main/publishing/platforms/instagram.js';
import desktopFacebook from '../src/main/publishing/platforms/facebook.js';
import desktopThreads from '../src/main/publishing/platforms/threads.js';
import { SHARED_PUBLISHERS } from '../src/shared/publish/index.js';
import { PublishError as DesktopPublishError, publishError } from '../src/main/publishing/errors.js';
import { PublishError } from '../src/shared/publish/errors.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const SHARED = path.join(ROOT, 'src/shared');

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
}

const importsOf = (src) => [...src.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g)].map((m) => m[1] ?? m[2] ?? m[3]);

describe('src/shared/publish purity (shared by the desktop and the self-hosted worker)', () => {
  const all = files(SHARED);

  it('has the extracted publishers', () => {
    const names = all.map((f) => path.relative(SHARED, f)).sort();
    expect(names).toEqual(expect.arrayContaining(['publish/instagram.js', 'publish/facebook.js', 'publish/threads.js', 'publish/index.js', 'publish/errors.js']));
  });

  it.each(files(SHARED).map((f) => [path.relative(ROOT, f), f]))('%s imports nothing from electron / db / config / i18n / the rest of src/main', (_rel, file) => {
    const src = fs.readFileSync(file, 'utf8');
    for (const spec of importsOf(src)) {
      expect(spec).not.toMatch(/^electron$|better-sqlite3/);
      if (spec.startsWith('.')) {
        const resolved = path.resolve(path.dirname(file), spec);
        expect(resolved.startsWith(SHARED + path.sep), `${spec} leaves src/shared`).toBe(true);
      } else {
        expect(spec, `${spec} must be a node: builtin`).toMatch(/^node:/);
      }
    }
    expect(src).not.toMatch(/\bprocess\.env\b/);
  });

  it('keeps the duplicated constants in sync with the desktop', () => {
    expect(SHARED_GRAPH_VERSION).toBe(GRAPH_VERSION);
    expect(sharedThreadsKey('1')).toBe(threadsKey('1'));
  });

  it('the desktop publishers ARE the shared ones (one implementation)', () => {
    expect(desktopInstagram).toBe(SHARED_PUBLISHERS.instagram);
    expect(desktopFacebook).toBe(SHARED_PUBLISHERS.facebook);
    expect(desktopThreads).toBe(SHARED_PUBLISHERS.threads);
    expect(DesktopPublishError).toBe(PublishError);
  });

  it('the desktop keeps localized PublishError messages', () => {
    const e = publishError('pub_host_missing');
    expect(e.message).not.toBe('pub_host_missing');
    expect(e).toMatchObject({ key: 'pub_host_missing', code: 'pub_host_missing', kind: 'config' });
  });

  it('the worker never imports desktop code', () => {
    for (const file of files(path.join(ROOT, 'worker/src'))) {
      for (const spec of importsOf(fs.readFileSync(file, 'utf8'))) {
        if (spec.startsWith('.')) expect(path.resolve(path.dirname(file), spec)).not.toContain(`${path.sep}src${path.sep}main${path.sep}`);
        else expect(spec).toMatch(/^node:/);
      }
    }
  });
});
