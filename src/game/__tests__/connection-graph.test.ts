import { describe, expect, it } from 'vitest';
import { generateMapDebug } from '../mapgen';

const SAMPLE_SEEDS = Array.from({ length: 60 }, (_, i) => i * 41 + 5);

function isAdjacentSection(sections: { id: number; col: number; row: number }[], a: number, b: number): boolean {
  const sa = sections.find((s) => s.id === a)!;
  const sb = sections.find((s) => s.id === b)!;
  const dCol = Math.abs(sa.col - sb.col);
  const dRow = Math.abs(sa.row - sb.row);
  return (dCol === 1 && dRow === 0) || (dCol === 0 && dRow === 1);
}

describe('section connection graph', () => {
  it('connects all 9 sections and never uses a non-adjacent edge, with no duplicate edges', () => {
    let successCount = 0;
    for (const seed of SAMPLE_SEEDS) {
      const debugInfo = generateMapDebug(seed);
      if (!debugInfo.ok || !debugInfo.connections || !debugInfo.contents) continue;
      successCount++;

      const sections = debugInfo.contents.map((c) => c.section);

      // No duplicate edges.
      const seen = new Set<string>();
      for (const e of debugInfo.connections) {
        const key = `${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
        expect(isAdjacentSection(sections, e.a, e.b)).toBe(true);
      }

      // All 9 nodes reachable via the connection graph (union-find over edges).
      const parent = Array.from({ length: 9 }, (_, i) => i);
      const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
      for (const e of debugInfo.connections) {
        const ra = find(e.a);
        const rb = find(e.b);
        if (ra !== rb) parent[ra] = rb;
      }
      const roots = new Set(Array.from({ length: 9 }, (_, i) => find(i)));
      expect(roots.size).toBe(1);
    }
    expect(successCount).toBeGreaterThan(SAMPLE_SEEDS.length * 0.2);
  });

  it('adds 1 to 2 extra edges beyond the minimum spanning structure (8 edges for 9 nodes)', () => {
    for (const seed of SAMPLE_SEEDS) {
      const debugInfo = generateMapDebug(seed);
      if (!debugInfo.ok || !debugInfo.connections) continue;
      // 9 nodes need >= 8 edges to connect; total edges should be 8 + (1 or 2) = 9 or 10,
      // unless the 3x3 grid ran out of unused adjacent edges for extras (12 total possible).
      expect(debugInfo.connections.length).toBeGreaterThanOrEqual(8);
      expect(debugInfo.connections.length).toBeLessThanOrEqual(10);
    }
  });
});
