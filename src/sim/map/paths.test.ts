import { describe, expect, it } from 'vitest';
import { TileMap, OWNED, RIGHTS_OWNED, PathFlag, ElementType } from './tile-map';
import { placePath, removePath, raiseLand } from './index';
import { TILE_UNITS, Z_STEP } from '../core/constants';

function ownedMap(): TileMap {
  const m = new TileMap(16, 16);
  m.fillFlat(4);
  m.ownership.fill(OWNED);
  return m;
}
const I = (m: TileMap, x: number, y: number): number => m.index(x, y);

describe('placePath', () => {
  it('places a ground path and marks the tile walkable', () => {
    const m = ownedMap();
    expect(m.isWalkable(I(m, 3, 3))).toBe(false);
    expect(placePath(m, { x: 3, y: 3 })).toBe(true);
    expect(m.isWalkable(I(m, 3, 3))).toBe(true);
    expect(m.surface[I(m, 3, 3)]).toBe(3);
  });

  it('auto-connects edges with adjacent paths, symmetrically', () => {
    const m = ownedMap();
    placePath(m, { x: 3, y: 3 });
    placePath(m, { x: 4, y: 3 });
    placePath(m, { x: 3, y: 4 });
    expect(m.pathEdges(I(m, 3, 3))).toBe(0b0011); // +x, +y
    expect(m.pathEdges(I(m, 4, 3))).toBe(0b0100); // -x
    expect(m.pathEdges(I(m, 3, 4))).toBe(0b1000); // -y
  });

  it('clears the neighbour edge when a path is removed', () => {
    const m = ownedMap();
    placePath(m, { x: 3, y: 3 });
    placePath(m, { x: 4, y: 3 });
    expect(removePath(m, { x: 4, y: 3 })).toBe(true);
    expect(m.pathEdges(I(m, 3, 3))).toBe(0);
    expect(m.isWalkable(I(m, 4, 3))).toBe(false);
  });

  it('requires construction rights', () => {
    const m = ownedMap();
    m.ownership[I(m, 3, 3)] = 0;
    expect(placePath(m, { x: 3, y: 3 })).toBe(false);
    m.ownership[I(m, 3, 3)] = RIGHTS_OWNED;
    expect(placePath(m, { x: 3, y: 3 })).toBe(true);
  });

  it('rejects out-of-bounds, water-covered and sloped-ground flat paths', () => {
    const m = ownedMap();
    expect(placePath(m, { x: -1, y: 0 })).toBe(false);
    expect(placePath(m, { x: 16, y: 0 })).toBe(false);
    m.waterLevel[I(m, 2, 2)] = 5;
    m.refreshTile(I(m, 2, 2));
    expect(placePath(m, { x: 2, y: 2 })).toBe(false);
    raiseLand(m, 8, 8, 1, 1, 0);
    expect(placePath(m, { x: 8, y: 8 })).toBe(false);
  });

  it('queue flag survives and can be replaced in place', () => {
    const m = ownedMap();
    placePath(m, { x: 3, y: 3, queue: true });
    const el = m.pathElement(I(m, 3, 3), -1);
    expect(m.elFlags[el] & PathFlag.Queue).toBeTruthy();
    expect(m.isQueue(I(m, 3, 3))).toBe(true);
    placePath(m, { x: 3, y: 3, queue: false });
    expect(m.isQueue(I(m, 3, 3))).toBe(false);
    expect(m.elementCount).toBe(1);
  });
});

describe('sloped paths', () => {
  it('connects a ramp to flat paths at matching heights only', () => {
    const m = ownedMap();
    // ramp on flat ground rising toward +x: low end at z=4, high end z=5
    expect(placePath(m, { x: 5, y: 5, slope: 0 })).toBe(true);
    placePath(m, { x: 4, y: 5 }); // flat z=4 at low end
    placePath(m, { x: 6, y: 5, z: 5 }); // flat z=5 at high end (elevated)
    placePath(m, { x: 5, y: 4 }); // flat beside the ramp: no side connection
    expect(m.pathEdges(I(m, 5, 5))).toBe(0b0101);
    expect(m.pathEdges(I(m, 4, 5))).toBe(0b0001);
    expect(m.pathEdges(I(m, 6, 5))).toBe(0b0100);
    expect(m.pathEdges(I(m, 5, 4))).toBe(0);
  });

  it('interpolates walking height along the ramp', () => {
    const m = ownedMap();
    placePath(m, { x: 5, y: 5, slope: 0 });
    const x0 = 5 * TILE_UNITS;
    const y0 = 5 * TILE_UNITS + 10;
    expect(m.heightAt(x0, y0)).toBe(4 * Z_STEP);
    expect(m.heightAt(x0 + 128, y0)).toBe(4 * Z_STEP + Z_STEP / 2);
    expect(m.heightAt(0, 3 * TILE_UNITS)).toBe(4 * Z_STEP);
  });

  it('sits on matching terrain slope', () => {
    const m = ownedMap();
    raiseLand(m, 8, 8, 1, 1, 1);
    raiseLand(m, 8, 8, 1, 1, 2);
    expect(m.slope[I(m, 8, 8)]).toBe(0b0110);
    expect(placePath(m, { x: 8, y: 8, slope: 0 })).toBe(true);
    expect(placePath(m, { x: 8, y: 8, slope: 2, z: 4 })).toBe(false); // wrong direction, same z
  });
});

describe('stacking and clearance', () => {
  it('allows an elevated path over a ground path and rejects overlaps', () => {
    const m = ownedMap();
    placePath(m, { x: 3, y: 3 });
    expect(placePath(m, { x: 3, y: 3, z: 5 })).toBe(false); // inside ground path clearance
    expect(placePath(m, { x: 3, y: 3, z: 6 })).toBe(true);
    expect(m.pathElement(I(m, 3, 3), 6)).toBeGreaterThanOrEqual(0);
    expect(m.pathEdges(I(m, 3, 3))).toBe(0); // different heights never connect
  });

  it('rejects a path below ground and bounds the build height', () => {
    const m = ownedMap();
    expect(placePath(m, { x: 3, y: 3, z: 2 })).toBe(false);
    expect(placePath(m, { x: 3, y: 3, z: 200 })).toBe(false);
  });

  it('refuses to place over other element classes', () => {
    const m = ownedMap();
    m.addElement(I(m, 3, 3), ElementType.SmallScenery, 4, 6, 0, 0);
    expect(placePath(m, { x: 3, y: 3 })).toBe(false);
  });
});

describe('forced edges', () => {
  it('lets other systems connect a path edge to a non-path neighbour', () => {
    const m = ownedMap();
    placePath(m, { x: 3, y: 3 });
    m.setForcedEdges(m.pathElement(I(m, 3, 3), -1), 0b0100);
    expect(m.pathEdges(I(m, 3, 3))).toBe(0b0100);
    placePath(m, { x: 4, y: 3 });
    expect(m.pathEdges(I(m, 3, 3))).toBe(0b0101);
  });
});

describe('pathfinder integration', () => {
  it('exposes edges as a PathGraph and bumps pathVersion on path edits', async () => {
    const { resolveGraph } = await import('../pathfinding/graph');
    const m = ownedMap();
    expect(resolveGraph(m)).toBe(m);
    const v0 = m.pathVersion;
    placePath(m, { x: 3, y: 3 });
    placePath(m, { x: 4, y: 3 });
    expect(m.pathVersion).toBeGreaterThan(v0);
    expect(m.edgeMask(I(m, 3, 3))).toBe(0b0001);
    const v1 = m.pathVersion;
    removePath(m, { x: 4, y: 3 });
    expect(m.pathVersion).toBeGreaterThan(v1);
  });
});
