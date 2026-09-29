/**
 * Demo inbox data — STUB (v2.0 chunk B). Chunk D owns this file: seeds inbox_state (open/replied/done, assignees,
 * sentiment) for the demo comments and multi-platform demo comments (FB/Threads/YouTube) with a deterministic PRNG.
 * Called by seed/index.js seedDemo() inside a transaction after every platform is seeded. Must not change the RNG
 * streams of existing demo data (use its own rng(seed)).
 * @param {{ now: Date }} o
 */
export function seedInbox({ now } = {}) {
  void now;
  return { skipped: true };
}
