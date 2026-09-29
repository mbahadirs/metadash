import { parseArgs } from 'node:util';
import { EXIT } from './exitCodes.js';
import { createOutput } from './output.js';
import { CliUsageError } from './resolve.js';
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
 * already open (src/main/index.js). Skeleton by chunk B; chunk F2 owns this file and the non-feature commands.
 *
 * Global options: --help, --version, --json, --user-data <dir> (handled before app ready), --lang <code>,
 * --log-file <file>. Exit codes: cli/exitCodes.js.
 */
export const COMMANDS = Object.freeze([sync, report, exportCmd, accounts, status, team, worker, inbox]);
// `backup` is an alias handled by the export command.
const ALIASES = Object.freeze({ backup: 'export' });

const GLOBAL_OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  json: { type: 'boolean' },
  'user-data': { type: 'string' },
  lang: { type: 'string' },
  'log-file': { type: 'string' },
};

export function usage() {
  const lines = COMMANDS.map((c) => `  ${c.name.padEnd(10)} ${c.summary}`);
  return ['Usage: metadash <command> [options]', '', 'Commands:', ...lines, '', 'Global options: --help --version --json --user-data <dir> --lang <code> --log-file <file>'].join('\n');
}

export { userDataArg } from './argv.js';

/**
 * Runs the CLI. argv = arguments after `--cli`. deps (tests): { stdout, stderr, version }.
 * @returns {Promise<number>} exit code
 */
export async function runCli(argv, deps = {}) {
  let name;
  try {
    // First pass (lenient) only finds the command name, so option values such as --user-data <dir> are not mistaken for it.
    name = parseArgs({ args: argv, options: GLOBAL_OPTIONS, allowPositionals: true, strict: false }).positionals[0];
  } catch {
    name = undefined;
  }
  const cmd = COMMANDS.find((c) => c.name === (ALIASES[name] ?? name));
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: { ...GLOBAL_OPTIONS, ...(cmd?.options ?? {}) }, allowPositionals: true, strict: !!cmd });
  } catch (e) {
    (deps.stderr ?? process.stderr).write(`${e.message}\n${usage()}\n`);
    return EXIT.USAGE;
  }
  const out = createOutput({ json: !!parsed.values.json, stdout: deps.stdout, stderr: deps.stderr, logFile: parsed.values['log-file'] ?? null });
  if (parsed.values.version) { out.result(parsed.values.json ? { version: deps.version ?? null } : String(deps.version ?? '')); return EXIT.OK; }
  if (!cmd || parsed.values.help) {
    out.result(usage());
    return cmd || parsed.values.help ? EXIT.OK : name ? EXIT.USAGE : EXIT.OK;
  }
  try {
    const positionals = parsed.positionals.slice(parsed.positionals.indexOf(name) + 1);
    return await cmd.run(parsed.values, { out, argv, positionals, lang: parsed.values.lang ?? null, alias: name });
  } catch (e) {
    if (e instanceof CliUsageError) {
      out.error(e.message);
      if (e.candidates) out.error(e.candidates.join('\n'));
      return EXIT.USAGE;
    }
    out.error(e?.message ?? String(e));
    return EXIT.ERROR;
  }
}
