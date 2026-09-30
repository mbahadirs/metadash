#!/usr/bin/env node
/**
 * End-to-end smoke test of the headless CLI (v2.0 chunk F2): seeds demo data into a temporary user-data folder, then
 * runs the real Electron app with `--cli` (no window) for every F2 command, including a PDF report through the hidden
 * BrowserWindow. Usage: `node scripts/cli-smoke.mjs [--keep]`. Linux without a display: runs under `xvfb-run -a` when
 * available (CI), otherwise set DISPLAY or pass --ozone-platform=headless via METADASH_SMOKE_ELECTRON_ARGS.
 * Exit 0 when every check passes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ELECTRON = require('electron'); // path to the Electron binary when required from plain Node
const KEEP = process.argv.includes('--keep');
const TIMEOUT_MS = 180_000;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-cli-smoke-'));
const out = path.join(dir, 'out');
const extraArgs = (process.env.METADASH_SMOKE_ELECTRON_ARGS ?? '').split(' ').filter(Boolean);

const hasXvfb = () => process.platform === 'linux' && !process.env.DISPLAY && spawnSync('which', ['xvfb-run']).status === 0;
const results = [];

function exec(cmd, args, env) {
  const [bin, argv] = hasXvfb() && !env.ELECTRON_RUN_AS_NODE ? ['xvfb-run', ['-a', cmd, ...args]] : [cmd, args];
  return spawnSync(bin, argv, { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8', timeout: TIMEOUT_MS });
}

/** Runs `electron . --cli --user-data <dir> …args`. */
function cli(args) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const r = exec(ELECTRON, ['.', ...extraArgs, '--cli', '--user-data', dir, ...args], env);
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
}

function check(name, fn) {
  try {
    const detail = fn();
    results.push({ name, ok: true });
    console.log(`ok   ${name}${detail ? ` (${detail})` : ''}`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`FAIL ${name}: ${e.message}`);
  }
}

function expectCode(r, code) {
  if (r.error) throw r.error;
  if (r.code !== code) throw new Error(`exit ${r.code}, expected ${code}\n${r.stderr.slice(-800)}`);
}

const json = (r) => JSON.parse(r.stdout.trim().split('\n').pop());

// 1. Seed demo data into the temporary folder (run-as-node, like `npm run seed`).
const seed = exec(ELECTRON, ['scripts/seed.js', '--reset'], { ELECTRON_RUN_AS_NODE: '1', METADASH_USER_DATA: dir });
if (seed.status !== 0) {
  console.error('seed failed', seed.stderr || seed.error);
  process.exit(1);
}

check('--version', () => { const r = cli(['--version', '--json']); expectCode(r, 0); return json(r).version; });
check('unknown command exits 2', () => expectCode(cli(['frobnicate']), 2));
check('report --help', () => { const r = cli(['report', '--help']); expectCode(r, 0); if (!r.stdout.includes('--template')) throw new Error('no help'); });

let firstIg = null;
check('accounts --json', () => {
  const r = cli(['accounts', '--platform', 'instagram', '--json']);
  expectCode(r, 0);
  const rows = json(r);
  if (!rows.length) throw new Error('no accounts');
  firstIg = rows[0];
  return `${rows.length} instagram accounts`;
});
check('status --json', () => { const r = cli(['status', '--json']); expectCode(r, 0); const st = json(r); if (!st.connections.length) throw new Error('no connections'); return `${st.accounts.total} accounts`; });
check('sync (demo) --json', () => { const r = cli(['sync', '--scope', 'organic', '--platform', 'ig', '--account', firstIg.key, '--json']); expectCode(r, 0); return json(r).status; });

const reportArgs = () => ['report', '--template', 'monthly', '--account', firstIg.key, '--period', 'last_30d'];
check('report html', () => {
  const file = path.join(out, 'report.html');
  expectCode(cli([...reportArgs(), '--out', file]), 0);
  if (!fs.readFileSync(file, 'utf8').startsWith('<!doctype html>')) throw new Error('not html');
});
check('report pdf (hidden BrowserWindow)', () => {
  const file = path.join(out, '{account}-{date}.pdf');
  const r = cli([...reportArgs(), '--out', file, '--json']);
  expectCode(r, 0);
  const written = json(r).files[0].file;
  const head = fs.readFileSync(written).subarray(0, 5).toString('latin1');
  if (head !== '%PDF-') throw new Error(`not a PDF: ${head}`);
  return `${Math.round(fs.statSync(written).size / 1024)} KB`;
});
check('report xlsx (portfolio)', () => {
  const file = path.join(out, 'portfolio.xlsx');
  expectCode(cli(['report', '--template', 'portfolio', '--out', file]), 0);
  if (fs.readFileSync(file).subarray(0, 2).toString('latin1') !== 'PK') throw new Error('not an xlsx (zip)');
});
check('export csv', () => {
  const file = path.join(out, 'media.csv');
  expectCode(cli(['export', 'csv', '--query', 'media', '--out', file]), 0);
  return `${fs.readFileSync(file, 'utf8').split('\r\n').length - 1} rows`;
});
check('backup', () => {
  const file = path.join(out, 'backup.metadash');
  expectCode(cli(['backup', '--out', file, '--quiet']), 0);
  return `${Math.round(fs.statSync(file).size / 1024)} KB`;
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${KEEP ? ` · files in ${dir}` : ''}`);
if (!KEEP) fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);
