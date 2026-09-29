import { EXIT } from '../exitCodes.js';

/**
 * `sync` command — STUB (v2.0 chunk B). Owner: chunk F2.
 * Usage: metadash sync [--scope full|organic|ads|stories|competitors|inbox] [--platform a,b] [--account @x …]
 * Contract: export const command = { name, summary, options (node:util parseArgs options), run(args, io) → exit code }.
 * io = { out (cli/output.js), argv, positionals, lang }.
 */
export const command = {
  name: 'sync',
  summary: 'metadash sync [--scope full|organic|ads|stories|competitors|inbox] [--platform a,b] [--account @x …]',
  options: {},
  async run(_args, io) {
    io.out.error('sync: not implemented yet');
    return EXIT.NOT_IMPLEMENTED;
  },
};
