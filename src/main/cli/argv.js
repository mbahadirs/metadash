/**
 * Raw-argv helpers used by src/main/index.js before app ready (pure, tiny: imported by the GUI entry too).
 */

/** `--user-data <dir>` / `--user-data=<dir>` from raw argv. */
export function userDataArg(argv) {
  const i = argv.indexOf('--user-data');
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith('--user-data='));
  return eq ? eq.slice('--user-data='.length) : null;
}
