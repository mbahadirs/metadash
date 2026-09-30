import fs from 'node:fs';
import path from 'node:path';
import { EXIT } from '../exitCodes.js';
import { listOpt, cliT, usageError, oneOf, services } from '../args.js';
import { CSV_QUERIES, runReadOnly, toCsv } from '../../export/csv.js';
import { writeWorkbook } from '../../export/xlsx.js';
import { exportAll } from '../../export/transfer.js';
import { loadBranding } from '../../export/brandingStore.js';

/**
 * `metadash export` — tables as CSV / Excel (the Settings → Export presets, or a read-only SELECT) and `backup`
 * (full data transfer file, same as Settings → Transfer; secrets only with a passphrase from an environment variable).
 */
const SUBCOMMANDS = ['csv', 'xlsx', 'list', 'backup'];
const MAX_ROWS = 1_000_000;

const DEFAULTS = {
  queries: CSV_QUERIES, runReadOnly, writeWorkbook, exportAll, loadBranding, env: process.env,
  stdout: null,
};

export const command = {
  name: 'export',
  summary: 'metadash export csv|xlsx --query <name>[,…] | --sql "<select>" --out <file> · export list · backup --out <file>',
  help: [
    'Exports tables or a full backup.',
    '',
    '  export list                               the built-in queries',
    '  export csv  --query <name> --out <file>   one query as CSV (--out - writes to stdout)',
    '  export csv  --sql "SELECT …" --out <file> a read-only query of your own (SELECT / WITH only)',
    '  export xlsx --query a,b --out <file>      several queries, one sheet each',
    '  backup --out <file> [--passphrase-env VAR]',
    '                                            full transfer file (Settings → Transfer). Secrets are kept only when',
    '                                            VAR holds a passphrase (never pass it on the command line).',
  ].join('\n'),
  options: {
    query: { type: 'string', multiple: true },
    sql: { type: 'string' },
    out: { type: 'string', short: 'o' },
    'passphrase-env': { type: 'string' },
  },
  async run(values, io) {
    const s = services(io, DEFAULTS);
    const sub = io.alias === 'backup' ? 'backup' : oneOf(io, io.positionals?.[0] ?? '', SUBCOMMANDS, 'export <csv|xlsx|list|backup>');
    if (sub === 'list') return listQueries(s, io);
    if (!values.out) throw usageError(io, 'cli_err_out_required');
    if (sub === 'backup') return backup(values, io, s);
    return tables(sub, values, io, s);
  },
};

function listQueries(s, io) {
  const rows = Object.keys(s.queries).map((name) => ({ name }));
  io.out.result(io.out.json ? rows.map((r) => r.name) : rows, { columns: [{ key: 'name', label: 'QUERY' }] });
  return EXIT.OK;
}

/** [{ name, sql }] from --query names (validated) or --sql. */
function pickQueries(values, io, s) {
  const names = listOpt(values.query);
  if (values.sql && names.length) throw usageError(io, 'cli_err_query_or_sql');
  if (values.sql) return [{ name: 'query', sql: values.sql }];
  if (!names.length) throw usageError(io, 'cli_err_query_required');
  return names.map((name) => {
    if (!s.queries[name]) throw usageError(io, 'cli_err_bad_value', { name: '--query', value: name, list: Object.keys(s.queries).join(', ') });
    return { name, sql: s.queries[name] };
  });
}

async function tables(sub, values, io, s) {
  const t = cliT(io);
  const queries = pickQueries(values, io, s);
  if (sub === 'csv' && queries.length > 1) throw usageError(io, 'cli_err_csv_one_query');
  const results = queries.map((q) => ({ ...q, ...s.runReadOnly(q.sql, MAX_ROWS) }));
  const rows = results.reduce((n, r) => n + r.rows.length, 0);
  if (sub === 'csv' && values.out === '-') {
    (s.stdout ?? process.stdout).write(`${toCsv(results[0].columns, results[0].rows).replace(/^﻿/, '')}\r\n`);
    return EXIT.OK;
  }
  const file = path.resolve(values.out);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (sub === 'csv') fs.writeFileSync(file, toCsv(results[0].columns, results[0].rows), 'utf8');
  else {
    const sheets = results.map((r) => ({ name: r.name, columns: r.columns.map((c) => ({ key: c, label: c, type: 'text' })), rows: r.rows }));
    await s.writeWorkbook(file, sheets, { title: s.loadBranding().agencyName ?? '' });
  }
  for (const r of results) if (r.truncated) io.out.warn(t('cli_export_truncated', { name: r.name, n: MAX_ROWS }));
  if (io.out.json) io.out.result({ file, format: sub, rows, queries: results.map((r) => ({ name: r.name, rows: r.rows.length })) });
  else io.out.result(t('cli_export_done', { file, rows }));
  return EXIT.OK;
}

async function backup(values, io, s) {
  const t = cliT(io);
  const envName = values['passphrase-env'];
  let passphrase = null;
  if (envName) {
    passphrase = s.env[envName] ?? '';
    if (!passphrase) throw usageError(io, 'cli_err_passphrase_env', { name: envName });
  } else io.out.warn(t('cli_backup_no_secrets'));
  const file = path.resolve(values.out);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const res = await s.exportAll({ filePath: file, passphrase, appVersion: io.version ?? null });
  const { filePath, size, secretsKept, secretsDropped, accounts, media } = res;
  if (io.out.json) io.out.result({ file: filePath, size, secretsKept, secretsDropped, accounts, media });
  else io.out.result(t('cli_backup_done', { file: filePath, size: Math.round(size / 1024), accounts, media }));
  return EXIT.OK;
}
