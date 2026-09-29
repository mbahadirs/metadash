import { EXIT } from '../exitCodes.js';

/**
 * `report` command — STUB (v2.0 chunk B). Owner: chunk F2.
 * Usage: metadash report --template <t> --account @x [--from --to | --period p] [--lang] [--format pdf|html|xlsx] [--sections a,b] [--commentary ai|none] --out file
 * Contract: export const command = { name, summary, options (node:util parseArgs options), run(args, io) → exit code }.
 * io = { out (cli/output.js), argv, positionals, lang }.
 */
export const command = {
  name: 'report',
  summary: 'metadash report --template <t> --account @x [--from --to | --period p] [--lang] [--format pdf|html|xlsx] [--sections a,b] [--commentary ai|none] --out file',
  options: {},
  async run(_args, io) {
    io.out.error('report: not implemented yet');
    return EXIT.NOT_IMPLEMENTED;
  },
};
