import { EXIT } from '../exitCodes.js';

/**
 * `worker` command — STUB (v2.0 chunk B). Owner: chunk E.
 * Usage: metadash worker sync | worker status
 * Contract: export const command = { name, summary, options (node:util parseArgs options), run(args, io) → exit code }.
 * io = { out (cli/output.js), argv, positionals, lang }.
 */
export const command = {
  name: 'worker',
  summary: 'metadash worker sync | worker status',
  options: {},
  async run(_args, io) {
    io.out.error('worker: not implemented yet');
    return EXIT.NOT_IMPLEMENTED;
  },
};
