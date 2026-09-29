import { extendDemoDay } from '../seed/index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Per-platform label suffix and simulated API calls per phase (profile, media, insights). */
const DEMO_PLATFORM = {
  instagram: { suffix: '', calls: [1, 2, 6] },
  facebook: { suffix: ' (FB)', calls: [2, 2, 7] }, // + page token
  threads: { suffix: ' (Threads)', calls: [1, 1, 6] },
};
const demoPlatform = (a) => DEMO_PLATFORM[a.platform ?? 'instagram'] ?? DEMO_PLATFORM.instagram;

/**
 * Simulated sync used when the active profile is a demo profile.
 * Walks the same phases, emits progress, and rolls the seeded dataset forward one day.
 * `accounts` may include every platform; stories only run for `storyAccounts` (Instagram).
 */
export async function runDemoSync({ scope, accounts, storyAccounts, adAccounts, competitors, signal, onStep }) {
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
      const { suffix, calls } = demoPlatform(a);
      const label = `${a.username}${suffix}`;
      await step('accounts', label, calls[0]);
      if (signal.aborted) break;
      onStep({ phase: 'media', label, done: done - 1, apiCalls: (apiCalls += calls[1]) });
      await sleep(15);
      onStep({ phase: 'insights', label, done: done - 1, apiCalls: (apiCalls += calls[2]) });
      await sleep(15);
    }
  }
  const stories = storyAccounts ?? accounts.filter((a) => (a.platform ?? 'instagram') === 'instagram');
  if (scope === 'full' || scope === 'stories') for (const a of stories) await step('stories', `${a.username} (story)`, 2);
  for (const ad of adAccounts) await step('ads', ad.name, 7);
  for (const c of competitors) await step('competitors', `@${c.username}`, 1);
  if (!signal.aborted) extendDemoDay(accounts.map((a) => a.igId));
  return { apiCalls };
}
