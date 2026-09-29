import { EXIT } from '../exitCodes.js';

/**
 * `team` command — STUB (v2.0 chunk B). Owner: chunk F1.
 * Usage: metadash team publish | team pull
 * Contract: export const command = { name, summary, options (node:util parseArgs options), run(args, io) → exit code }.
 * io = { out (cli/output.js), argv, positionals, lang }.
 */
export const command = {
  name: 'team',
  summary: 'metadash team publish | team pull',
  options: {},
  async run(_args, io) {
    io.out.error('team: not implemented yet');
    return EXIT.NOT_IMPLEMENTED;
  },
};
