import crypto from 'node:crypto';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const SALT = 'metadash-machine-v1';
let cached = null;

/** Stable per-machine identifier: hardware UUID (mac) / MachineGuid (win) / machine-id (linux), salted + hashed. */
export function machineId() {
  if (cached) return cached;
  let raw = '';
  try {
    if (process.platform === 'darwin') {
      const out = execSync('ioreg -rd1 -c IOPlatformExpertDevice', { encoding: 'utf8', timeout: 5000 });
      raw = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(out)?.[1] ?? '';
    } else if (process.platform === 'win32') {
      const out = execSync('reg query HKLM\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid', { encoding: 'utf8', timeout: 5000, windowsHide: true });
      raw = /MachineGuid\s+REG_SZ\s+([^\s]+)/.exec(out)?.[1] ?? '';
    } else {
      raw = fs.existsSync('/etc/machine-id') ? fs.readFileSync('/etc/machine-id', 'utf8').trim() : '';
    }
  } catch {
    raw = '';
  }
  if (!raw) raw = `${os.hostname()}|${os.cpus()[0]?.model ?? ''}|${os.totalmem()}`;
  cached = crypto.createHash('sha256').update(SALT + '|' + raw).digest('hex');
  return cached;
}
