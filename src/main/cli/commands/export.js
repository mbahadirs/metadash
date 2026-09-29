import { EXIT } from '../exitCodes.js';

/**
 * `export` command — STUB (v2.0 chunk B). Owner: chunk F2.
 * Usage: metadash export csv --query <name> --out <file> | metadash backup --out <file>
 * Contract: export const command = { name, summary, options (node:util parseArgs options), run(args, io) → exit code }.
 * io = { out (cli/output.js), argv, positionals, lang }.
 */
export const command = {
  name: 'export',
  summary: 'metadash export csv --query <name> --out <file> | metadash backup --out <file>',
  options: {},
  async run(_args, io) {
    io.out.error('export: not implemented yet');
    return EXIT.NOT_IMPLEMENTED;
  },
};
