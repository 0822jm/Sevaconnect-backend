import { pickWeighted, defaultWeightFn } from '../weightedPick';

describe('pickWeighted', () => {
  it('returns null for an empty pool', () => {
    expect(pickWeighted([])).toBeNull();
  });

  it('always returns the only candidate', () => {
    const c = { id: 'a', trustScore: 50 };
    expect(pickWeighted([c])).toBe(c);
  });

  it('default weight is trust + 20 (floor for low/new maids)', () => {
    expect(defaultWeightFn({ trustScore: 0 })).toBe(20);
    expect(defaultWeightFn({ trustScore: 50 })).toBe(70);
    expect(defaultWeightFn({ trustScore: 100 })).toBe(120);
  });

  it('selects by weight using the injected rng (deterministic)', () => {
    const pool = [
      { id: 'low', trustScore: 0 },    // weight 20
      { id: 'high', trustScore: 100 }, // weight 120  (total 140)
    ];
    expect(pickWeighted(pool, defaultWeightFn, () => 0)!.id).toBe('low');        // r=0   → low
    expect(pickWeighted(pool, defaultWeightFn, () => 19 / 140)!.id).toBe('low'); // r=19  → low
    expect(pickWeighted(pool, defaultWeightFn, () => 20 / 140)!.id).toBe('high');// r=20  → high
    expect(pickWeighted(pool, defaultWeightFn, () => 0.99)!.id).toBe('high');    // r≈139 → high
  });

  it('honours a custom weight function', () => {
    const pool = [{ id: 'a', trustScore: 0 }, { id: 'b', trustScore: 0 }];
    const onlyB = (m: any) => (m.id === 'b' ? 100 : 0);
    expect(pickWeighted(pool, onlyB, () => 0.5)!.id).toBe('b');
  });

  it('falls back to uniform when all weights are zero', () => {
    const pool = [{ id: 'a', trustScore: 0 }, { id: 'b', trustScore: 0 }];
    const pick = pickWeighted(pool, () => 0, () => 0)!;
    expect(['a', 'b']).toContain(pick.id);
  });
});
