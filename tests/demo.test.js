import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, closeDb } from '../src/main/db/index.js';
import { seedDemo, clearAll, canLoadDemo } from '../src/main/seed/index.js';
import { upsertProfile } from '../src/main/db/queries/profiles.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-demo-'));
openDb(path.join(dir, 'data.db'));
afterAll(() => { closeDb(); fs.rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => clearAll());

describe('demo data guard', () => {
  it('allows demo data on an empty database', () => {
    expect(canLoadDemo()).toBe(true);
  });
  it('allows reloading demo data over existing demo data', () => {
    seedDemo({ reset: true });
    expect(canLoadDemo()).toBe(true);
  });
  it('refuses demo data while a real Meta connection exists', () => {
    upsertProfile({ label: 'Real', appId: '123456', tokenRef: 'token:profile', tokenExpiresAt: null });
    expect(canLoadDemo()).toBe(false);
  });
});
