import { EXIT } from '../exitCodes.js';

/**
 * `status` command — STUB (v2.0 chunk B). Owner: chunk F2.
 * Usage: metadash status [--json]  (last sync, token health per auth, quota, worker/team status)
 * Contract: export const command = { name, summary, options (node:util parseArgs options), run(args, io) → exit code }.
 * io = { out (cli/output.js), argv, positionals, lang }.
 */
export const command = {
  name: 'status',
  summary: 'metadash status [--json]  (last sync, token health per auth, quota, worker/team status)',
  options: {},
  async run(_args, io) {
    io.out.error('status: not implemented yet');
    return EXIT.NOT_IMPLEMENTED;
  },
};
