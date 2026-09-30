import fs from 'node:fs';
import path from 'node:path';

/**
 * CLI output. Human mode prints aligned tables / lines to stdout; --json prints one JSON document per result.
 * Progress and diagnostics go to stderr so stdout stays machine-readable (--quiet silences progress/info).
 * --log-file <file> appends everything (results included) with timestamps — on Windows the GUI-subsystem exe may not
 * reach cmd.exe's stdout, so scheduled tasks should use --log-file / --out. Secrets are never printed.
 */
export function createOutput({ json = false, quiet = false, stdout = process.stdout, stderr = process.stderr, logFile = null, now = () => new Date() } = {}) {
  const logLines = [];
  const log = (line) => { if (logFile) logLines.push(`${now().toISOString()} ${line}`); };
  return {
    json,
    quiet,
    /** Result document (JSON mode) or a table / lines (human mode). */
    result(data, { columns } = {}) {
      let text;
      if (json) text = JSON.stringify(data);
      else if (Array.isArray(data) && columns) text = table(data, columns);
      else text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      stdout.write(`${text}\n`);
      log(text);
    },
    /** Progress / status line on stderr (suppressed by --quiet). */
    info(line) {
      if (!quiet) stderr.write(`${line}\n`);
      log(line);
    },
    /** Warning on stderr (always shown). */
    warn(line) { stderr.write(`${line}\n`); log(`WARN ${line}`); },
    error(line) { stderr.write(`${line}\n`); log(`ERROR ${line}`); },
    logLines,
    /** Appends the collected lines to --log-file (creating its folder). Never throws. */
    flush() {
      if (!logFile || !logLines.length) return;
      try {
        fs.mkdirSync(path.dirname(path.resolve(logFile)), { recursive: true });
        fs.appendFileSync(logFile, `${logLines.join('\n')}\n`, 'utf8');
        logLines.length = 0;
      } catch (e) {
        stderr.write(`log file: ${e.message}\n`);
      }
    },
  };
}

/** Plain-text table: columns = [{ key, label, align? 'right' }]. */
export function table(rows, columns) {
  const cells = rows.map((r) => columns.map((c) => String(r[c.key] ?? '')));
  const widths = columns.map((c, i) => Math.max(c.label.length, ...cells.map((row) => row[i].length)));
  const pad = (v, i) => (columns[i].align === 'right' ? v.padStart(widths[i]) : v.padEnd(widths[i]));
  const line = (vals) => vals.map(pad).join('  ').trimEnd();
  return [line(columns.map((c) => c.label)), ...cells.map(line)].join('\n');
}
