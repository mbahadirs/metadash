/** v2.0 F1 `metadash team status | publish | pull` exit codes and output. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, closeDb } from '../src/main/db/index.js';
import { setSetting } from '../src/main/db/queries/settings.js';
import { command } from '../src/main/cli/commands/team.js';
import { createOutput } from '../src/main/cli/output.js';
import { EXIT } from '../src/main/cli/exitCodes.js';
import { setIdentity, createTeam, __resetTeamForTests } from '../src/main/team/index.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-team-cli-'));
const sink = () => { const chunks = []; return { write: (s) => { chunks.push(s); return true; }, text: () => chunks.join('') }; };
async function run(positionals) {
  const stdout = sink();
  const stderr = sink();
  const code = await command.run({}, { out: createOutput({ json: true, stdout, stderr }), positionals, argv: [], lang: 'en' });
  return { code, out: stdout.text(), err: stderr.text() };
}

beforeAll(() => {
  __resetTeamForTests();
  openDb(path.join(dir, 'data.db'));
});
afterAll(() => {
  __resetTeamForTests();
  closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('team command', () => {
  it('status works outside a team; publish/pull are usage errors there', async () => {
    const s = await run([]);
    expect(s.code).toBe(EXIT.OK);
    expect(JSON.parse(s.out)).toMatchObject({ mode: 'none', members: [] });
    expect((await run(['publish'])).code).toBe(EXIT.USAGE);
    expect((await run(['pull'])).code).toBe(EXIT.USAGE);
    expect((await run(['explode'])).code).toBe(EXIT.USAGE);
  });

  it('publishes as the publisher', async () => {
    setIdentity({ name: 'Cli Admin', handle: 'cli' });
    fs.mkdirSync(path.join(dir, 'shared'));
    await createTeam({ folder: path.join(dir, 'shared'), name: 'CLI team' });
    const r = await run(['publish']);
    expect(r.code).toBe(EXIT.OK);
    expect(JSON.parse(r.out)).toMatchObject({ mode: 'publisher', team: 'CLI team', encrypted: false });
    expect((await run(['pull'])).code).toBe(EXIT.OK);
  });

  it('refuses to publish from a subscriber (read-only exit code)', async () => {
    setSetting('team.config', { mode: 'subscriber', teamId: 'x', folder: path.join(dir, 'nowhere') });
    expect((await run(['publish'])).code).toBe(EXIT.READ_ONLY);
  });
});
