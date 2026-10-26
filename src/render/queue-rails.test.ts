import { describe, expect, it } from 'vitest';
import { flatWorld, row } from '../sim/integration/fixtures';
import { applyMapCommand, previewPathRun } from '../sim/map/map-commands';
import { queueRailSprites } from './world-art';

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

function lay(w: ReturnType<typeof flatWorld>, tiles: Array<[number, number]>): void {
  applyMapCommand(w, {
    type: 'placePathRun',
    placements: tiles.map(([x, y]) => ({ x, y, queue: true })),
  });
}

describe('rails between queue tiles', () => {
  it('stand on every unlinked edge between adjacent queue tiles, once, in every rotation', () => {
    const w = flatWorld();
    lay(w, row(5, 3, 7));
    lay(w, row(6, 4, 6));
    lay(w, row(7, 3, 7));
    const m = w.map;
    const flags = (x: number, y: number): number => m.elFlags[m.pathElement(m.index(x, y), -1)]!;
    for (const rotation of [0, 1, 2, 3]) {
      const drawn = new Set<string>();
      for (let y = 5; y <= 7; y++)
        for (let x = 3; x <= 7; x++)
          for (const rail of queueRailSprites(flags(x, y), rotation))
            drawn.add(`${x},${y},${rail.worldDir}`);
      for (const [x, y, d] of [
        [4, 5, 1],
        [5, 5, 1],
        [6, 5, 1],
      ] as const) {
        const nx = x + DX[d]!;
        const ny = y + DY[d]!;
        const linked = (flags(x, y) & (1 << d)) !== 0;
        expect(linked, `${x},${y} to ${nx},${ny}`).toBe(false);
        const here = drawn.has(`${x},${y},${d}`);
        const there = drawn.has(`${nx},${ny},${(d + 2) & 3}`);
        expect(here !== there, `one rail on the edge (rotation ${rotation})`).toBe(true);
      }
    }
  });

  it('shows in the path preview exactly the links the run will have', () => {
    const w = flatWorld();
    const run = [...row(5, 3, 6), ...row(6, 3, 6).reverse()].map(([x, y]) => ({
      x,
      y,
      queue: true,
    }));
    const preview = previewPathRun(w, run);
    lay(
      w,
      run.map((p) => [p.x, p.y]),
    );
    run.forEach((p, k) => {
      expect(preview[k]!.edges).toBe(w.map.pathEdges(w.map.index(p.x, p.y)));
    });
    expect(preview[0]!.edges & (1 << 1)).toBe(0);
    expect(preview[3]!.edges & (1 << 1)).not.toBe(0);
  });
});
