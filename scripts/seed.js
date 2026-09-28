import { openDb, closeDb } from '../src/main/db/index.js';
import { dbPath } from '../src/main/paths.js';
import { seedDemo } from '../src/main/seed/index.js';

const reset = process.argv.includes('--reset');
const file = dbPath();
openDb(file);
const t = Date.now();
const res = seedDemo({ reset, onProgress: (m) => process.stdout.write(`\r${m.padEnd(50)}`) });
process.stdout.write('\n');
if (res.skipped) console.log(`Database already contains demo data (${file}). Use --reset to start over.`);
else console.log(`Demo data written: ${res.accounts} accounts, ${Date.now() - t} ms → ${file}`);
closeDb();
