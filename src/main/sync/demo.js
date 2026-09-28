import { extendDemoDay } from '../seed/index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Simulated sync used when the active profile is a demo profile.
 * Walks the same phases, emits progress, and rolls the seeded dataset forward one day.
 */
export async function runDemoSync({ scope, accounts, adAccounts, competitors, signal, onStep }) {
  let done = 0;
  let apiCalls = 0;
  const step = async (phase, label, calls) => {
    if (signal.aborted) return;
    apiCalls += calls;
    onStep({ phase, label, done, apiCalls });
    await sleep(35);
    done += 1;
    onStep({ phase, label, done, apiCalls });
  };
  if (scope === 'full' || scope === 'organic') {
    for (const a of accounts) {
      await step('accounts', a.username, 1);
      if (signal.aborted) break;
      onStep({ phase: 'media', label: a.username, done: done - 1, apiCalls: (apiCalls += 2) });
      await sleep(15);
      onStep({ phase: 'insights', label: a.username, done: done - 1, apiCalls: (apiCalls += 6) });
      await sleep(15);
    }
  }
  if (scope === 'full' || scope === 'stories') for (const a of accounts) await step('stories', `${a.username} (story)`, 2);
  for (const ad of adAccounts) await step('ads', ad.name, 7);
  for (const c of competitors) await step('competitors', `@${c.username}`, 1);
  if (!signal.aborted) extendDemoDay(accounts.map((a) => a.igId));
  return { apiCalls };
}
