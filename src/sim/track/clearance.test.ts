import { describe, expect, it } from 'vitest';
import { TILE_UNITS, Z_STEP } from '../core/constants';
import { pieceByName } from './catalog';
import { groundHeightAt, pieceTunnelPortals, undergroundTiles } from './clearance';
import type { TerrainTiles } from './clearance';

const W = 16;

/** A W x W map whose tile base level and corner mask come from callbacks. */
function terrain(
  level: (x: number, y: number) => number,
  mask: (x: number, y: number) => number = () => 0,
): TerrainTiles {
  const heights = new Uint8Array(W * W);
  const slope = new Uint8Array(W * W);
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      heights[y * W + x] = level(x, y);
      slope[y * W + x] = mask(x, y);
    }
  return { width: W, height: W, heights, slope };
}

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

const id = (name: string): number => pieceByName(name)!.id;
const flat = terrain(() => 5);

describe('groundHeightAt', () => {
  it('interpolates across the corners a slope mask raises', () => {
    const ramp = terrain(
      () => 5,
      () => 0b0110,
    );
    expect(groundHeightAt(ramp, 3 * TILE_UNITS, 3 * TILE_UNITS)).toBe(5 * Z_STEP);
    expect(groundHeightAt(ramp, 3 * TILE_UNITS + 255, 3 * TILE_UNITS)).toBeGreaterThan(
      5 * Z_STEP + Z_STEP * 0.9,
    );
  });
});

describe('undergroundTiles', () => {
  it('is empty for a piece resting on flat ground, and at the ground level of its ends', () => {
    expect(undergroundTiles(flat, id('flat'), 4, 4, 5, 0)).toEqual([]);
    expect(undergroundTiles(flat, id('station'), 4, 4, 5, 2)).toEqual([]);
  });

  it('reports the tiles of a piece sunk below flat ground', () => {
    expect(undergroundTiles(flat, id('flat'), 4, 4, 4, 0)).toContain(4 * W + 4);
  });

  it('catches a raised corner that the tile base level alone would miss', () => {
    const lump = terrain(
      () => 5,
      (x, y) => (x === 4 && y === 4 ? 0b0010 : 0),
    );
    expect(undergroundTiles(lump, id('flat'), 4, 4, 5, 0).length).toBeGreaterThan(0);
    expect(undergroundTiles(lump, id('flat'), 4, 4, 6, 0)).toEqual([]);
  });

  it('flags a flat piece that runs into a one-level terrace riser', () => {
    const terrace = fromVertices((vx) => (vx >= 6 ? 6 : 5));
    expect(undergroundTiles(terrace, id('flat'), 5, 4, 5, 0)).toContain(4 * W + 5);
    expect(undergroundTiles(terrace, id('flat'), 4, 4, 5, 0)).toEqual([]);
    expect(undergroundTiles(terrace, id('flat'), 5, 4, 6, 0)).toEqual([]);
  });

  it('lets a climbing piece follow a ramp it matches without reporting it underground', () => {
    const ramp = terrain(
      (x) => 5 + Math.min(x - 4, 0) * 0,
      (x) => (x === 4 ? 0b0110 : 0),
    );
    expect(undergroundTiles(ramp, id('flatToUp25'), 3, 4, 5, 0)).toEqual([]);
  });
});

describe('pieceTunnelPortals', () => {
  const wall = fromVertices((vx) => 5 + Math.min(3, Math.max(0, vx - 5)));

  it('puts no portal on a piece wholly above or wholly below ground', () => {
    expect(pieceTunnelPortals(flat, id('flat'), 4, 4, 5, 0)).toEqual([]);
    expect(pieceTunnelPortals(wall, id('flat'), 10, 4, 5, 0)).toEqual([]);
  });

  it('marks a flat piece entering a hillside, facing back toward the approach', () => {
    const portals = pieceTunnelPortals(wall, id('flat'), 5, 4, 5, 0);
    expect(portals).toHaveLength(1);
    expect(portals[0]).toMatchObject({ entering: true, facing: 2 });
    expect(portals[0]!.x).toBeGreaterThanOrEqual(5 * TILE_UNITS);
    expect(portals[0]!.x).toBeLessThanOrEqual(6 * TILE_UNITS);
  });

  it('marks the exit of a piece leaving the hill, facing the way the track travels', () => {
    const away = fromVertices((vx) => 8 - Math.min(3, Math.max(0, vx - 5)));
    const portals = pieceTunnelPortals(away, id('flat'), 7, 4, 5, 0);
    expect(portals).toHaveLength(1);
    expect(portals[0]).toMatchObject({ entering: false, facing: 0 });
  });

  it.each([0, 1, 2, 3])('turns the portal with the piece direction %i', (dir) => {
    const mid = 8;
    const hill = fromVertices((vx, vy) => {
      const along = [vx - mid, vy - mid, mid + 1 - vx, mid + 1 - vy][dir]!;
      return 5 + Math.min(3, Math.max(0, along));
    });
    const portals = pieceTunnelPortals(hill, id('flat'), mid, mid, 5, dir);
    expect(portals).toHaveLength(1);
    expect(portals[0]).toMatchObject({ entering: true, facing: (dir + 2) & 3 });
  });

  it('gives a sloped piece a portal where its centre line dips through the ground', () => {
    const portals = pieceTunnelPortals(wall, id('flatToDown25'), 5, 4, 8, 0);
    expect(portals.length).toBeLessThanOrEqual(1);
    const climbing = pieceTunnelPortals(wall, id('flatToUp25'), 4, 4, 5, 0);
    expect(climbing.every((p) => p.facing === 2 || p.facing === 0)).toBe(true);
  });

  it('reports a transition once: the next piece shares the boundary sample and has none', () => {
    const first = pieceTunnelPortals(wall, id('flat'), 5, 4, 5, 0);
    const second = pieceTunnelPortals(wall, id('flat'), 6, 4, 5, 0);
    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
  });
});
