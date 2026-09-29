import { EXIT } from '../exitCodes.js';

/**
 * `inbox` command — STUB (v2.0 chunk B). Owner: chunk D.
 * Usage: metadash inbox pull | inbox sla [--json]
 * Contract: export const command = { name, summary, options (node:util parseArgs options), run(args, io) → exit code }.
 * io = { out (cli/output.js), argv, positionals, lang }.
 */
export const command = {
  name: 'inbox',
  summary: 'metadash inbox pull | inbox sla [--json]',
  options: {},
  async run(_args, io) {
    io.out.error('inbox: not implemented yet');
    return EXIT.NOT_IMPLEMENTED;
  },
};
