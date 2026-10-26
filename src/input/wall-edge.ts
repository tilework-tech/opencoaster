import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import type { TileMap } from '../sim/map/tile-map';
import { project } from '../render/projection';
import type { Camera } from '../render/renderer';
import { terrainTileCorners } from '../render/terrain-geometry';

const EDGE_CORNERS = [
  [1, 2],
  [2, 3],
  [3, 0],
  [0, 1],
] as const;

/** Selects the world-space tile edge nearest a pointer on the rendered terrain diamond. */
export function nearestWallEdge(
  screenX: number,
  screenY: number,
  map: Pick<TileMap, 'width' | 'height' | 'heights' | 'slope'>,
  camera: Camera,
  viewport: { width: number; height: number },
  x: number,
  y: number,
): number {
  const tile = y * map.width + x;
  const corners = terrainTileCorners(x, y, map.heights[tile]!, map.slope[tile]!);
  const projected = corners.map((corner) => {
    const point = new Float64Array(2);
    project(
      corner.x * TILE_UNITS,
      corner.y * TILE_UNITS,
      corner.height * Z_STEP,
      map.width,
      map.height,
      camera.rotation,
      point,
    );
    return [
      viewport.width / 2 + (point[0]! - camera.x) * camera.zoom,
      viewport.height / 2 + (point[1]! - camera.y) * camera.zoom,
    ] as const;
  });
  let selected = 0;
  let nearest = Number.POSITIVE_INFINITY;
  for (let edge = 0; edge < EDGE_CORNERS.length; edge++) {
    const [start, end] = EDGE_CORNERS[edge]!;
    const [ax, ay] = projected[start]!;
    const [bx, by] = projected[end]!;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const amount =
      lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, ((screenX - ax) * dx + (screenY - ay) * dy) / lengthSquared));
    const px = ax + amount * dx;
    const py = ay + amount * dy;
    const distanceSquared = (screenX - px) ** 2 + (screenY - py) ** 2;
    if (distanceSquared < nearest) {
      nearest = distanceSquared;
      selected = edge;
    }
  }
  return selected;
}
