import { describe, expect, it } from 'vitest';
import { World } from '../sim/core/world';
import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import { project } from '../render/projection';
import { terrainTileCorners } from '../render/terrain-geometry';
import { nearestWallEdge } from './wall-edge';

describe('wall edge selection', () => {
  it('selects the closest terrain edge in each camera rotation, including slopes', () => {
    const map = new World({ seed: 9, width: 8, height: 8 }).map;
    const x = 3;
    const y = 3;
    const tile = map.index(x, y);
    map.heights[tile] = 4;
    map.slope[tile] = 0b1010;
    const viewport = { width: 800, height: 600 };
    for (let rotation = 0; rotation < 4; rotation++) {
      const camera = { x: 0, y: 0, zoom: 1, rotation: rotation as 0 | 1 | 2 | 3 };
      const corners = terrainTileCorners(x, y, 4, 0b1010);
      for (let edge = 0; edge < 4; edge++) {
        const [a, b] = [
          [1, 2],
          [2, 3],
          [3, 0],
          [0, 1],
        ][edge]!;
        const pa = new Float64Array(2);
        const pb = new Float64Array(2);
        project(
          corners[a]!.x * TILE_UNITS,
          corners[a]!.y * TILE_UNITS,
          corners[a]!.height * Z_STEP,
          8,
          8,
          camera.rotation,
          pa,
        );
        project(
          corners[b]!.x * TILE_UNITS,
          corners[b]!.y * TILE_UNITS,
          corners[b]!.height * Z_STEP,
          8,
          8,
          camera.rotation,
          pb,
        );
        const screenX = viewport.width / 2 + ((pa[0]! + pb[0]!) / 2 - camera.x) * camera.zoom;
        const screenY = viewport.height / 2 + ((pa[1]! + pb[1]!) / 2 - camera.y) * camera.zoom;
        expect(
          nearestWallEdge(screenX, screenY, map, camera, viewport, x, y),
          `view ${rotation}, edge ${edge}`,
        ).toBe(edge);
      }
    }
  });
});
