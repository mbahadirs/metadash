import { EXIT } from '../exitCodes.js';

/**
 * `accounts` command — STUB (v2.0 chunk B). Owner: chunk F2.
 * Usage: metadash accounts [--platform p] [--json]
 * Contract: export const command = { name, summary, options (node:util parseArgs options), run(args, io) → exit code }.
 * io = { out (cli/output.js), argv, positionals, lang }.
 */
export const command = {
  name: 'accounts',
  summary: 'metadash accounts [--platform p] [--json]',
  options: {},
  async run(_args, io) {
    io.out.error('accounts: not implemented yet');
    return EXIT.NOT_IMPLEMENTED;
  },
};
