/**
 * v2.0 CLI (chunk F2): the `metadash` shim behind Settings → Command-line tool (cli:status / installShim / uninstallShim).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shimEnv, shimDirs, shimContent, directCommand, cliStatus, installShim, uninstallShim, SHIM_MARKER, ShimError } from '../src/main/cli/shim.js';

let home;
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-shim-')); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const linux = (extra = {}) => shimEnv({ platform: 'linux', home, pathEnv: '/usr/bin', execPath: '/opt/MetaDash/metadash', isPackaged: true, ...extra });

describe('shim content and locations', () => {
  it('uses the per-OS default folders', () => {
    expect(shimDirs(linux())).toEqual([path.posix.join(home, '.local', 'bin')]); // the simulated Linux env joins with POSIX separators
    expect(shimDirs(shimEnv({ platform: 'darwin', home: '/Users/me' }))).toEqual(['/usr/local/bin', '/Users/me/.local/bin']);
    expect(shimDirs(shimEnv({ platform: 'win32', home: 'C:\\Users\\me', localAppData: 'C:\\Users\\me\\AppData\\Local' }))).toEqual(['C:\\Users\\me\\AppData\\Local\\MetaDash\\bin']);
  });

  it('writes an exec shim that forwards arguments (quoted safely)', () => {
    const mac = shimContent(shimEnv({ platform: 'darwin', execPath: "/Applications/Meta Dash's.app/Contents/MacOS/MetaDash", isPackaged: true }));
    expect(mac).toContain(SHIM_MARKER);
    expect(mac).toMatch(/^#!\/bin\/sh\n/);
    expect(mac).toContain(`exec '/Applications/Meta Dash'\\''s.app/Contents/MacOS/MetaDash' --cli "$@"`);
    const dev = shimContent(linux({ isPackaged: false, execPath: '/repo/node_modules/electron/dist/electron', appPath: '/repo' }));
    expect(dev).toContain(`exec '/repo/node_modules/electron/dist/electron' '/repo' --cli "$@"`);
    const win = shimContent(shimEnv({ platform: 'win32', execPath: 'C:\\Users\\me\\AppData\\Local\\Programs\\MetaDash\\MetaDash.exe' }));
    expect(win).toBe(`@echo off\r\nrem ${SHIM_MARKER}: runs MetaDash in command-line mode (Settings > Command-line tool)\r\n"C:\\Users\\me\\AppData\\Local\\Programs\\MetaDash\\MetaDash.exe" --cli %*\r\n`);
    expect(directCommand(shimEnv({ platform: 'darwin', execPath: '/Applications/MetaDash.app/Contents/MacOS/MetaDash' }))).toBe('/Applications/MetaDash.app/Contents/MacOS/MetaDash --cli');
  });
});

// These tests simulate POSIX installs on the host file system; Windows temp paths (C:\…) can't stand in for them.
describe.skipIf(process.platform === 'win32')('install / status / uninstall', () => {
  it('installs into ~/.local/bin, reports PATH reachability and removes only its own file', () => {
    expect(cliStatus(linux())).toMatchObject({ installed: false, shimPath: null, command: '/opt/MetaDash/metadash --cli', platform: 'linux' });
    const st = installShim(linux());
    const file = path.join(home, '.local', 'bin', 'metadash');
    expect(st).toMatchObject({ installed: true, shimPath: file, onPath: false, command: file });
    expect(fs.statSync(file).mode & 0o111).toBeTruthy();
    expect(cliStatus(linux({ pathEnv: `/usr/bin:${path.join(home, '.local', 'bin')}/` }))).toMatchObject({ onPath: true, command: 'metadash' });
    expect(uninstallShim(linux())).toMatchObject({ installed: false });
    expect(fs.existsSync(file)).toBe(false);
  });

  it('never overwrites a foreign file and validates custom folders', () => {
    const bin = path.join(home, '.local', 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'metadash'), '#!/bin/sh\necho someone else\n');
    expect(() => installShim(linux())).toThrow(ShimError);
    expect(() => installShim(linux(), { dir: 'relative/dir' })).toThrow(expect.objectContaining({ code: 'cli_shim_bad_dir' }));
    uninstallShim(linux());
    expect(fs.readFileSync(path.join(bin, 'metadash'), 'utf8')).toContain('someone else');

    const custom = path.join(home, 'tools');
    fs.mkdirSync(custom);
    const st = installShim(linux(), { dir: custom });
    expect(st).toMatchObject({ installed: true, shimPath: path.join(custom, 'metadash') });
    expect(cliStatus(linux()).installed).toBe(false); // custom folders are found once remembered (cli.handlers stores them)
    expect(cliStatus(linux({ extraDirs: [custom] }))).toMatchObject({ installed: true, shimPath: path.join(custom, 'metadash') });
    uninstallShim(linux({ extraDirs: [custom] }));
    expect(fs.existsSync(path.join(custom, 'metadash'))).toBe(false);
  });
});
