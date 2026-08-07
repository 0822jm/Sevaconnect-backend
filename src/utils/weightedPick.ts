// Weighted random selection for the "any maid" pool.
//
// The weight function is PLUGGABLE on purpose: today it's trust-based, but future
// signals (price, distance, availability-reliability, household affinity, a fairness
// term to spread work more evenly) can be composed in without touching the picker.

export interface WeightedCandidate {
  trustScore: number;
  [key: string]: any;
}

export type WeightFn<T extends WeightedCandidate = WeightedCandidate> = (candidate: T) => number;

// Linear with a floor: `trust + 20` (trust is 0–100, new maids default to 50) so lower-trust /
// newer maids still get a real chance rather than being starved out.
export const defaultWeightFn: WeightFn = (m) => m.trustScore + 20;

/**
 * Pick one candidate at random, weighted by `weightFn` — probability of candidate i is
 * `weight_i / Σ weight`. Returns null for an empty pool. `rng` (a 0..1 source) is injectable
 * for deterministic tests; defaults to Math.random.
 */
export function pickWeighted<T extends WeightedCandidate>(
  pool: T[],
  weightFn: WeightFn<T> = defaultWeightFn as WeightFn<T>,
  rng: () => number = Math.random,
): T | null {
  if (pool.length === 0) return null;
  const weights = pool.map((c) => Math.max(0, weightFn(c)));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return pool[Math.floor(rng() * pool.length)] ?? pool[0]; // all-zero → uniform
  let r = rng() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r < 0) return pool[i];
  }
  return pool[pool.length - 1]; // floating-point safety net
}
