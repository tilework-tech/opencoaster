import { describe, expect, it } from 'vitest';
import { OWNED, SALE_LAND } from '../sim/map/tile-map';
import { landOverlayTiles, parkBoundaryEdges } from './park-boundary';
import type { MapData } from './renderer';

function mapWithOwned(owned: Array<[number, number]>): MapData {
  const ownership = new Uint8Array(16);
  for (const [x, y] of owned) ownership[y * 4 + x] = OWNED;
  return {
    width: 4,
    height: 4,
    heights: new Uint8Array(16),
    surface: new Uint8Array(16),
    slope: new Uint8Array(16),
    ownership,
  } as MapData;
}

function triples(edges: Int32Array): string[] {
  const out: string[] = [];
  for (let i = 0; i < edges.length; i += 3) out.push(`${edges[i]},${edges[i + 1]},${edges[i + 2]}`);
  return out.sort();
}

describe('parkBoundaryEdges', () => {
  it('puts a fence on every edge of owned land facing unowned land', () => {
    expect(triples(parkBoundaryEdges(mapWithOwned([[1, 1]])))).toEqual(
      ['1,1,0', '1,1,1', '1,1,2', '1,1,3'].sort(),
    );
    // Two owned neighbours share no fence between them.
    expect(
      triples(
        parkBoundaryEdges(
          mapWithOwned([
            [1, 1],
            [2, 1],
          ]),
        ),
      ),
    ).toEqual(['1,1,1', '1,1,2', '1,1,3', '2,1,0', '2,1,1', '2,1,3'].sort());
  });

  it('fences owned land at the map border', () => {
    expect(triples(parkBoundaryEdges(mapWithOwned([[0, 0]])))).toEqual(
      ['0,0,0', '0,0,1', '0,0,2', '0,0,3'].sort(),
    );
  });
});

describe('landOverlayTiles', () => {
  it('covers every unowned tile and borders a sale offer where it meets other land', () => {
    const map = mapWithOwned([[0, 0]]);
    map.ownership![1] = SALE_LAND;
    map.ownership![2] = SALE_LAND;
    const tiles = landOverlayTiles(map);
    expect(tiles).toHaveLength(15);
    const at = (x: number, y: number) => tiles.find((t) => t.x === x && t.y === y)!;
    expect(at(1, 0).sale).toBe(SALE_LAND);
    // Bordered toward the owned tile (-x), the unoffered tile below (+y) and the map edge (-y),
    // but not toward the neighbouring land offer (+x).
    expect(at(1, 0).borders).toBe(0b1110);
    expect(at(3, 3)).toEqual({ x: 3, y: 3, sale: 0, borders: 0 });
  });
});
