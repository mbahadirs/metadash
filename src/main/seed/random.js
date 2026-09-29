/** Deterministic PRNG so the demo looks the same on every machine. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
export const between = (r, a, b) => a + r() * (b - a);
export const gauss = (r) => (r() + r() + r() + r() - 2) / 1.2;
