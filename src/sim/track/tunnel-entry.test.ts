import { describe, expect, it } from 'vitest';
import { TRACK_STEPS_PER_LEVEL } from '../core/constants';
import { pieceByName } from './catalog';
import { badTunnelEntry, pieceTunnelPortals } from './clearance';
import type { TerrainTiles } from './clearance';

const W = 16;
const id = (name: string): number => pieceByName(name)!.id;

/** Terrain from a corner height function, so neighbouring tiles share their corners. */
function fromVertices(vertex: (vx: number, vy: number) => number): TerrainTiles {
  const heights = new Uint8Array(W * W);
  const slope = new Uint8Array(W * W);
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      const c = [vertex(x, y), vertex(x + 1, y), vertex(x + 1, y + 1), vertex(x, y + 1)];
      const base = Math.min(...c);
      heights[y * W + x] = base;
      slope[y * W + x] = c.reduce((m, h, k) => m | (h > base ? 1 << k : 0), 0);
    }
  return { width: W, height: W, heights, slope };
}

const LEVEL = 5;
/** Track height of a piece resting at ground level, in track steps. */
const Z = LEVEL * TRACK_STEPS_PER_LEVEL;
/** A piece at (6, 4) heading +x enters its tile through the west edge. */
const ENTRY = { x: 6, y: 4 };

describe('which land shapes allow a tunnel entry', () => {
  it('allows the side of a gentle hill, rising one level straight away from the edge, as a slope', () => {
    const hill = fromVertices((vx) => LEVEL + Math.min(1, Math.max(0, vx - 6)));
    const portals = pieceTunnelPortals(hill, id('flat'), ENTRY.x, ENTRY.y, Z, 0);
    expect(portals).toHaveLength(1);
    expect(portals[0]).toMatchObject({ valid: true, variant: 'slope', entering: true, facing: 2 });
    expect(badTunnelEntry(hill, id('flat'), ENTRY.x, ENTRY.y, Z, 0)).toBe(false);
  });

  it('allows a steep hillside that keeps rising as a face', () => {
    const hill = fromVertices((vx) => LEVEL + Math.min(3, Math.max(0, vx - 6)));
    const portals = pieceTunnelPortals(hill, id('flat'), ENTRY.x, ENTRY.y, Z, 0);
    expect(portals).toHaveLength(1);
    expect(portals[0]).toMatchObject({ valid: true, variant: 'face', entering: true });
  });

  it('allows an exit through the far side of a hill', () => {
    const hill = fromVertices((vx) => LEVEL + 3 - Math.min(3, Math.max(0, vx - 6)));
    const portals = pieceTunnelPortals(hill, id('flat'), 8, ENTRY.y, Z, 0);
    expect(portals).toHaveLength(1);
    expect(portals[0]).toMatchObject({ valid: true, entering: false, facing: 0 });
  });

  it('allows track sloping down into flat ground, as a cut', () => {
    const plain = fromVertices(() => LEVEL);
    const portals = pieceTunnelPortals(plain, id('flatToDown25'), 6, 4, Z, 0);
    expect(portals).toHaveLength(1);
    expect(portals[0]).toMatchObject({ valid: true, variant: 'cut', entering: true });
  });

  it.each([
    ['a single raised corner', (vx: number, vy: number) => LEVEL + (vx === 7 && vy === 4 ? 1 : 0)],
    [
      'a raised corner on the edge the track crosses',
      (vx: number, vy: number) => LEVEL + (vx === 6 && vy === 4 ? 1 : 0),
    ],
    [
      'a diagonal ridge',
      (vx: number, vy: number) => LEVEL + (vx - 6 === vy - 4 && vx >= 6 ? 1 : 0),
    ],
    [
      'a slope that runs sideways across the track',
      (vx: number, vy: number) => LEVEL + (vy > 4 && vx >= 6 ? 1 : 0),
    ],
    ['a saddle', (vx: number, vy: number) => LEVEL + ((vx + vy) % 2 === 0 && vx >= 6 ? 1 : 0)],
  ])('refuses an entry through %s', (_name, vertex) => {
    const land = fromVertices(vertex);
    const portals = [ENTRY.x - 1, ENTRY.x].flatMap((x) =>
      pieceTunnelPortals(land, id('flat'), x, ENTRY.y, Z, 0),
    );
    expect(portals.length).toBeGreaterThan(0);
    expect(portals.every((p) => !p.valid)).toBe(true);
    expect(
      [ENTRY.x - 1, ENTRY.x].some((x) => badTunnelEntry(land, id('flat'), x, ENTRY.y, Z, 0)),
    ).toBe(true);
  });

  it.each([0, 1, 2, 3])('judges the same shapes in every direction (%i)', (dir) => {
    const mid = 8;
    const hill = fromVertices((vx, vy) => {
      const along = [vx - mid, vy - mid, mid + 1 - vx, mid + 1 - vy][dir]!;
      return LEVEL + Math.min(3, Math.max(0, along));
    });
    const portals = pieceTunnelPortals(hill, id('flat'), mid, mid, Z, dir);
    expect(portals).toHaveLength(1);
    expect(portals[0]).toMatchObject({ valid: true });
    const cornerHill = fromVertices((vx, vy) => LEVEL + (vx === mid + 2 && vy === mid ? 1 : 0));
    expect(badTunnelEntry(cornerHill, id('flat'), mid, mid, Z, dir)).toBe(false);
  });
});
