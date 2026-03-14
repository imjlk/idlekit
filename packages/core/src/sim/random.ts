export type Random = () => number;

export function mulberry32(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function deriveDrawSeed(baseSeed: number, drawIndex: number): number {
  const rng = mulberry32((baseSeed ^ ((drawIndex + 1) * 0x9e3779b9)) >>> 0);
  return Math.floor(rng() * 0xffffffff) >>> 0;
}
