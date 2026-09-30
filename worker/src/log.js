/**
 * Redacting JSON-lines logger. Never logs tokens, secrets, signatures, envelopes or request bodies: keys matching
 * SENSITIVE are replaced, and token-looking strings inside messages are masked. No telemetry: logs go to stdout only.
 */
const SENSITIVE = /token|secret|envelope|authorization|sig|password|key|body|caption|cookie/i;
const TOKENISH = /\b(EAA[A-Za-z0-9]{10,}|TH[A-Za-z0-9]{20,}|IG[A-Za-z0-9]{20,}|[A-Za-z0-9_-]{40,})\b/g;
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export const redactText = (s) => String(s ?? '').replace(TOKENISH, '[redacted]');

export function redact(value, depth = 0) {
  if (value == null || depth > 4) return value;
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SENSITIVE.test(k) ? '[redacted]' : redact(v, depth + 1)]));
  }
  return value;
}

/** @param {{ level?: string, write?: (line: string) => void, now?: () => number }} [opts] */
export function createLogger({ level = 'info', write = (line) => process.stdout.write(`${line}\n`), now = Date.now } = {}) {
  const min = LEVELS[level] ?? LEVELS.info;
  const emit = (lvl, msg, fields) => {
    if (LEVELS[lvl] < min) return;
    write(JSON.stringify({ t: new Date(now()).toISOString(), level: lvl, msg: redactText(msg), ...(fields ? redact(fields) : {}) }));
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}

export const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };
