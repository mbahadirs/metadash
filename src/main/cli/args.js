import { msg } from '../i18n.js';
import { CliUsageError } from './resolve.js';

/**
 * Small helpers shared by the CLI commands (pure apart from msg()).
 */

/** Flattens a string | string[] option (repeatable and/or comma-separated) into trimmed, non-empty values. */
export function listOpt(value) {
  const arr = value == null ? [] : Array.isArray(value) ? value : [value];
  return arr.flatMap((v) => String(v).split(',')).map((s) => s.trim()).filter(Boolean);
}

/** Localizer bound to the command's --lang (falls back to the configured UI language). */
export function cliT(io) {
  return (key, vars) => msg(key, vars, io?.lang ?? undefined);
}

/** Throws a localized usage error (exit 2). */
export function usageError(io, key, vars, extra) {
  return new CliUsageError(cliT(io)(key, vars), extra);
}

/** Validates an enum option; returns the value or throws a usage error listing the allowed values. */
export function oneOf(io, value, allowed, name) {
  if (!allowed.includes(value)) throw usageError(io, 'cli_err_bad_value', { name, value, list: allowed.join(', ') });
  return value;
}

/** Shared service lookup: io.services (tests) overrides the defaults. */
export function services(io, defaults) {
  return { ...defaults, ...(io?.services ?? {}) };
}

/** Formats a timestamp (ms) as local 'YYYY-MM-DD HH:MM', or '' when missing. */
export function fmtTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
