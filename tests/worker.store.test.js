import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore, atomicWriteJson } from '../worker/src/store.js';

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdw-store-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('worker JSON store', () => {
  it('stamps every item change with a monotonic seq and pages the change feed', () => {
    const s = createStore({ dir });
    s.putItem({ id: 'a', status: 'queued' });
    s.putItem({ id: 'b', status: 'queued' });
    s.putItem({ ...s.getItem('a'), status: 'published' });
    expect(s.seq()).toBe(3);
    expect(s.changesSince(0).changes.map((c) => [c.id, c.seq])).toEqual([['b', 2], ['a', 3]]);
    expect(s.changesSince(2).changes.map((c) => c.id)).toEqual(['a']);
    expect(s.changesSince(3)).toEqual({ seq: 3, changes: [], more: false });
    const page = s.changesSince(0, 1);
    expect(page).toMatchObject({ seq: 2, more: true });
  });

  it('persists atomically and reloads after a crash (no tmp file left, stale tmp ignored)', () => {
    const s = createStore({ dir });
    s.putItem({ id: 'a', status: 'queued' });
    s.putToken('instagram:1', { sealed: 'v1.x', platform: 'instagram' });
    expect(fs.existsSync(path.join(dir, 'state.json.tmp'))).toBe(false);
    // Simulate a crash mid-write: a half-written tmp file must not affect the reload.
    fs.writeFileSync(path.join(dir, 'state.json.tmp'), '{"version":1,"seq":99,"ite');
    const again = createStore({ dir });
    expect(again.getItem('a')).toMatchObject({ status: 'queued', seq: 1 });
    expect(again.getToken('instagram:1')).toMatchObject({ sealed: 'v1.x' });
    expect(again.seq()).toBe(1);
  });

  it('does not change memory state when the write fails', () => {
    const s = createStore({ dir });
    s.putItem({ id: 'a', status: 'queued' });
    fs.chmodSync(dir, 0o500);
    try {
      expect(() => s.putItem({ id: 'b', status: 'queued' })).toThrow();
      expect(s.getItem('b')).toBeNull();
    } finally {
      fs.chmodSync(dir, 0o700);
    }
  });

  it('returns copies (callers cannot mutate the stored state)', () => {
    const s = createStore({ dir });
    s.putItem({ id: 'a', status: 'queued', payload: { media: [] } });
    const got = s.getItem('a');
    got.payload.media.push('x');
    expect(s.getItem('a').payload.media).toEqual([]);
  });

  it('reset removes items, tokens and media but keeps the cursor growing', () => {
    const s = createStore({ dir });
    s.putItem({ id: 'a' });
    s.putToken('k', {});
    s.putMedia('m', {});
    s.reset();
    expect([s.listItems(), s.listTokens(), s.listMedia()]).toEqual([[], [], []]);
    s.putItem({ id: 'b' });
    expect(s.getItem('b').seq).toBe(2);
  });

  it('atomicWriteJson replaces the file content', () => {
    const f = path.join(dir, 'x.json');
    atomicWriteJson(f, { a: 1 });
    atomicWriteJson(f, { a: 2 });
    expect(JSON.parse(fs.readFileSync(f, 'utf8'))).toEqual({ a: 2 });
  });
});
