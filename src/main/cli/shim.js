import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * `metadash` command shim (Settings → Command-line tool). A tiny script that runs the app binary with `--cli`:
 *   macOS   /usr/local/bin/metadash (falls back to ~/.local/bin when /usr/local/bin is not writable)
 *   Linux   ~/.local/bin/metadash
 *   Windows %LOCALAPPDATA%\MetaDash\bin\metadash.cmd (the user adds that folder to PATH)
 * Only files carrying SHIM_MARKER are ever overwritten or removed. All inputs injectable for tests.
 */
export const SHIM_MARKER = 'metadash-cli-shim';

/** env = { platform, home, localAppData, pathEnv, execPath, appPath, isPackaged, extraDirs (custom install folders), fs } */
export function shimEnv(overrides = {}) {
  return {
    platform: process.platform,
    home: os.homedir(),
    localAppData: process.env.LOCALAPPDATA ?? null,
    pathEnv: process.env.PATH ?? '',
    execPath: process.execPath,
    appPath: null,
    isPackaged: true,
    extraDirs: [],
    fs,
    ...overrides,
  };
}

const pathFor = (env) => (env.platform === 'win32' ? path.win32 : path.posix);
export const shimName = (env) => (env.platform === 'win32' ? 'metadash.cmd' : 'metadash');

/** Folders searched for an installed shim: the defaults plus custom folders used before. */
const knownDirs = (env) => [...new Set([...shimDirs(env), ...(env.extraDirs ?? [])])];

/** Default folders, preferred first. */
export function shimDirs(env) {
  const p = pathFor(env);
  if (env.platform === 'win32') return [p.join(env.localAppData ?? p.join(env.home, 'AppData', 'Local'), 'MetaDash', 'bin')];
  const local = p.join(env.home, '.local', 'bin');
  return env.platform === 'darwin' ? ['/usr/local/bin', local] : [local];
}

/** Direct invocation without a shim (what the docs and Settings show). */
export function directCommand(env) {
  const exe = env.execPath;
  const q = (s) => (/[\s"'$`\\]/.test(s) ? `"${s.replace(/(["\\$`])/g, '\\$1')}"` : s);
  if (env.platform === 'win32') return `"${exe}"${env.isPackaged ? '' : ` "${env.appPath}"`} --cli`;
  return `${q(exe)}${env.isPackaged ? '' : ` ${q(env.appPath)}`} --cli`;
}

/** Shim file content. Dev builds (not packaged) pass the app folder to the Electron binary. */
export function shimContent(env) {
  if (env.platform === 'win32') {
    const app = env.isPackaged ? '' : ` "${env.appPath}"`;
    return `@echo off\r\nrem ${SHIM_MARKER}: runs MetaDash in command-line mode (Settings > Command-line tool)\r\n"${env.execPath}"${app} --cli %*\r\n`;
  }
  const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const app = env.isPackaged ? '' : ` ${sq(env.appPath)}`;
  return `#!/bin/sh\n# ${SHIM_MARKER}: runs MetaDash in command-line mode (Settings > Command-line tool)\nexec ${sq(env.execPath)}${app} --cli "$@"\n`;
}

const isShim = (env, file) => {
  try { return env.fs.readFileSync(file, 'utf8').includes(SHIM_MARKER); } catch { return false; }
};

const onPath = (env, dir) => {
  const sep = env.platform === 'win32' ? ';' : ':';
  const norm = (d) => (env.platform === 'win32' ? d.replace(/[\\/]+$/, '').toLowerCase() : d.replace(/\/+$/, ''));
  return String(env.pathEnv ?? '').split(sep).filter(Boolean).map(norm).includes(norm(dir));
};

/** CliStatus { installed, shimPath, onPath, command, platform } (renderer lib/types.ts). */
export function cliStatus(env) {
  const p = pathFor(env);
  const file = knownDirs(env).map((d) => p.join(d, shimName(env))).find((f) => isShim(env, f)) ?? null;
  const dir = file ? p.dirname(file) : null;
  const reachable = !!dir && onPath(env, dir);
  return { installed: !!file, shimPath: file, onPath: reachable, command: file ? (reachable ? 'metadash' : file) : directCommand(env), platform: env.platform };
}

class ShimError extends Error {
  constructor(code, vars = {}) { super(code); this.code = code; this.vars = vars; }
}
export { ShimError };

/**
 * Writes the shim into `dir` (must be an absolute existing folder) or the first writable default folder
 * (created for ~/.local/bin and %LOCALAPPDATA%). Refuses to overwrite a file that is not our shim.
 */
export function installShim(env, { dir } = {}) {
  const p = pathFor(env);
  const dirs = dir ? [dir] : shimDirs(env);
  if (dir && (!p.isAbsolute(dir) || !env.fs.existsSync(dir) || !env.fs.statSync(dir).isDirectory())) throw new ShimError('cli_shim_bad_dir', { dir });
  let lastErr = null;
  for (const d of dirs) {
    const file = p.join(d, shimName(env));
    if (env.fs.existsSync(file) && !isShim(env, file)) { lastErr = new ShimError('cli_shim_exists', { file }); continue; }
    try {
      if (!dir && d !== '/usr/local/bin') env.fs.mkdirSync(d, { recursive: true });
      env.fs.writeFileSync(file, shimContent(env), { encoding: 'utf8', mode: 0o755 });
      if (env.platform !== 'win32') env.fs.chmodSync(file, 0o755);
      return cliStatus({ ...env, extraDirs: [...(env.extraDirs ?? []), d] });
    } catch (e) {
      lastErr = new ShimError('cli_shim_write_failed', { file, error: e.code ?? e.message });
    }
  }
  throw lastErr ?? new ShimError('cli_shim_write_failed', { file: '', error: '' });
}

/** Removes every shim of ours in the known folders (never other files). */
export function uninstallShim(env) {
  const p = pathFor(env);
  for (const d of knownDirs(env)) {
    const file = p.join(d, shimName(env));
    if (isShim(env, file)) {
      try { env.fs.rmSync(file, { force: true }); } catch (e) { throw new ShimError('cli_shim_remove_failed', { file, error: e.code ?? e.message }); }
    }
  }
  return cliStatus(env);
}
