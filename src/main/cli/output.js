/**
 * CLI output (skeleton; chunk F2 owns src/main/cli/** except commands owned by D/E/F1).
 * Human mode prints aligned tables to stdout; --json prints one JSON document (or JSON lines for streams).
 * Progress/diagnostics go to stderr so stdout stays machine-readable. Secrets are never printed.
 */
export function createOutput({ json = false, stdout = process.stdout, stderr = process.stderr, logFile = null } = {}) {
  const logLines = [];
  const log = (line) => { if (logFile) logLines.push(line); };
  return {
    json,
    /** Result document (JSON mode) or a table / lines (human mode). */
    result(data, { columns } = {}) {
      if (json) { stdout.write(`${JSON.stringify(data)}\n`); return; }
      if (Array.isArray(data) && columns) { stdout.write(`${table(data, columns)}\n`); return; }
      stdout.write(`${typeof data === 'string' ? data : JSON.stringify(data, null, 2)}\n`);
    },
    info(line) { stderr.write(`${line}\n`); log(line); },
    error(line) { stderr.write(`${line}\n`); log(`ERROR ${line}`); },
    logLines,
  };
}

/** Plain-text table: columns = [{ key, label }]. */
export function table(rows, columns) {
  const cells = rows.map((r) => columns.map((c) => String(r[c.key] ?? '')));
  const widths = columns.map((c, i) => Math.max(c.label.length, ...cells.map((row) => row[i].length)));
  const line = (vals) => vals.map((v, i) => v.padEnd(widths[i])).join('  ').trimEnd();
  return [line(columns.map((c) => c.label)), ...cells.map(line)].join('\n');
}
