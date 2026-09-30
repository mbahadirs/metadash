import { parseArgs } from 'node:util';
import { EXIT } from './exitCodes.js';
import { createOutput } from './output.js';
import { CliUsageError } from './resolve.js';
import { ReportParamError } from '../export/params.js';
import { msg, isSupportedLang, LANG_CODES } from '../i18n.js';
import { command as sync } from './commands/sync.js';
import { command as report } from './commands/report.js';
import { command as exportCmd } from './commands/export.js';
import { command as accounts } from './commands/accounts.js';
import { command as status } from './commands/status.js';
import { command as team } from './commands/team.js';
import { command as worker } from './commands/worker.js';
import { command as inbox } from './commands/inbox.js';

/**
 * Headless CLI entry (`MetaDash --cli <command> …`, dev: `npm run cli -- <command>`). Runs inside the real Electron
 * app (the RunAsNode fuse is off in packaged builds) with no window, updater, tray or notifications; the database is
 * already open (src/main/index.js). Chunk F2 owns this file and the non-feature commands; `team`, `worker` and `inbox`
 * belong to F1, E and D.
 *
 * Command contract: `export const command = { name, summary, help?, options, run(values, io) → exit code }` with
 * io = { out, argv, positionals, lang, alias, version, services? } (services: test injection, see cli/args.js services()).
 * Global options: --help, --version, --json, --quiet, --user-data <dir> (handled before app ready), --lang <code>,
 * --log-file <file>. Exit codes: cli/exitCodes.js.
 */
export const COMMANDS = Object.freeze([sync, report, exportCmd, accounts, status, team, worker, inbox]);
// `backup` is an alias handled by the export command.
const ALIASES = Object.freeze({ backup: 'export' });

const GLOBAL_OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  json: { type: 'boolean' },
  quiet: { type: 'boolean', short: 'q' },
  'user-data': { type: 'string' },
  lang: { type: 'string' },
  'log-file': { type: 'string' },
};

const GLOBAL_HELP = [
  'Global options:',
  '  --json               machine-readable output on stdout (one JSON document)',
  '  -q, --quiet          no progress lines on stderr',
  '  --lang <code>        language for messages and reports (en, tr, de, es)',
  '  --user-data <dir>    use another data folder (default: the app\'s own)',
  '  --log-file <file>    append all output to a file (recommended on Windows)',
  '  -h, --help           help (also: metadash help <command>)',
  '  -v, --version        app version',
].join('\n');

const EXIT_HELP = 'Exit codes: 0 ok, 1 error, 2 usage, 3 partial, 4 auth, 5 locked (sync running elsewhere), 6 read-only workspace, 7 not implemented.';

const findCommand = (name) => COMMANDS.find((c) => c.name === (ALIASES[name] ?? name));

export function usage() {
  const lines = COMMANDS.map((c) => `  ${c.name.padEnd(10)} ${c.summary}`);
  return ['Usage: metadash <command> [options]', '', 'Commands:', ...lines, '  backup     alias of: export backup', '', GLOBAL_HELP, '', EXIT_HELP].join('\n');
}

/** Help text of one command: its usage line, its own help and the global options. */
export function commandHelp(cmd) {
  return [`Usage: ${cmd.summary}`, ...(cmd.help ? ['', cmd.help] : []), '', GLOBAL_HELP, '', EXIT_HELP].join('\n');
}

export { userDataArg } from './argv.js';

/**
 * Runs the CLI. argv = arguments after `--cli`. deps (tests): { stdout, stderr, version, services }.
 * @returns {Promise<number>} exit code
 */
export async function runCli(argv, deps = {}) {
  const stderr = deps.stderr ?? process.stderr;
  let name;
  try {
    // First pass (lenient) only finds the command name, so option values such as --user-data <dir> are not mistaken for it.
    name = parseArgs({ args: argv, options: GLOBAL_OPTIONS, allowPositionals: true, strict: false }).positionals[0];
  } catch {
    name = undefined;
  }
  // `metadash help [command]`
  const helpFor = name === 'help' ? findCommand(parseArgs({ args: argv, options: GLOBAL_OPTIONS, allowPositionals: true, strict: false }).positionals[1]) : null;
  const cmd = name === 'help' ? null : findCommand(name);
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: { ...GLOBAL_OPTIONS, ...(cmd?.options ?? {}) }, allowPositionals: true, strict: !!cmd });
  } catch (e) {
    stderr.write(`${e.message}\n\n${cmd ? commandHelp(cmd) : usage()}\n`);
    return EXIT.USAGE;
  }
  const v = parsed.values;
  const out = createOutput({ json: !!v.json, quiet: !!v.quiet, stdout: deps.stdout, stderr, logFile: v['log-file'] ?? null });
  try {
    if (v.lang != null && !isSupportedLang(v.lang)) {
      out.error(msg('cli_err_bad_value', { name: '--lang', value: v.lang, list: LANG_CODES.join(', ') }));
      return EXIT.USAGE;
    }
    if (v.version) { out.result(v.json ? { version: deps.version ?? null } : String(deps.version ?? '')); return EXIT.OK; }
    if (name === 'help') { out.result(helpFor ? commandHelp(helpFor) : usage()); return EXIT.OK; }
    if (!cmd) {
      if (name && !v.help) { out.error(msg('cli_err_unknown_command', { name }, v.lang ?? undefined)); out.result(usage()); return EXIT.USAGE; }
      out.result(usage());
      return EXIT.OK;
    }
    if (v.help) { out.result(commandHelp(cmd)); return EXIT.OK; }
    const positionals = parsed.positionals.slice(parsed.positionals.indexOf(name) + 1);
    return await cmd.run(v, { out, argv, positionals, lang: v.lang ?? null, alias: name, version: deps.version ?? null, services: deps.services });
  } catch (e) {
    return reportError(out, e, v.lang);
  } finally {
    out.flush();
  }
}

/** Maps a thrown error to output + exit code. */
function reportError(out, e, lang) {
  if (e instanceof CliUsageError) {
    out.error(e.message);
    if (e.candidates?.length) out.error(e.candidates.map((c) => `  ${c}`).join('\n'));
    return EXIT.USAGE;
  }
  if (e instanceof ReportParamError) {
    out.error(msg(e.code, e.vars, lang ?? undefined));
    return EXIT.USAGE;
  }
  if (e?.code === 'NOT_IMPLEMENTED') { out.error(e.message); return EXIT.NOT_IMPLEMENTED; }
  out.error(e?.message ?? String(e));
  return EXIT.ERROR;
}
