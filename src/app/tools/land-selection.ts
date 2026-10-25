import { pickTile, TILE_H, TILE_W, Z_PIXELS } from '../../render/projection';
import type { Rotation } from '../../render/projection';

export interface LandSelection {
  /** Top-left tile and size of the square the action covers. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Corner mask: one bit a corner, two adjacent bits an edge, 0b1111 the whole tile. */
  corners: number;
  /** Tile under the cursor; flatten levels to its height. */
  cursorX: number;
  cursorY: number;
}

interface PickMap {
  width: number;
  height: number;
  heights: Uint8Array;
  slope: Uint8Array;
}

const WHOLE_TILE = 0b1111;
/** Distance from a corner, in tiles, within which that corner is picked. */
const CORNER_REACH = 0.32;
/** Distance from an edge, in tiles, within which that edge is picked. */
const EDGE_REACH = 0.2;
const CORNERS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
const EDGES = [0b0011, 0b0110, 0b1100, 0b1001];

/** Position inside the tile, as fractions of its width and depth in unrotated map axes. */
function tileFraction(
  screenX: number,
  screenY: number,
  tile: readonly [number, number],
  map: PickMap,
  camera: { x: number; y: number; zoom: number; rotation: Rotation },
  viewport: { width: number; height: number },
): [number, number] {
  const index = tile[1] * map.width + tile[0];
  const level = map.heights[index] + (map.slope[index] !== 0 ? 0.5 : 0);
  const worldX = camera.x + (screenX - viewport.width / 2) / camera.zoom;
  const worldY = camera.y + (screenY - viewport.height / 2) / camera.zoom + level * Z_PIXELS;
  const rx = (worldX / (TILE_W / 2) + worldY / (TILE_H / 2)) / 2;
  const ry = (worldY / (TILE_H / 2) - worldX / (TILE_W / 2)) / 2;
  let tx: number;
  let ty: number;
  switch (camera.rotation) {
    case 0:
      tx = rx;
      ty = ry;
      break;
    case 1:
      tx = ry;
      ty = map.height - rx;
      break;
    case 2:
      tx = map.width - rx;
      ty = map.height - ry;
      break;
    default:
      tx = map.width - ry;
      ty = rx;
      break;
  }
  return [Math.max(0, Math.min(1, tx - tile[0])), Math.max(0, Math.min(1, ty - tile[1]))];
}

/**
 * The land selection under a viewport-local point. A size-1 pick near a corner or edge of the
 * tile (when `snapCorners`) selects just that corner or edge; larger squares centre on the tile.
 */
export function pickLandSelection(
  screenX: number,
  screenY: number,
  map: PickMap,
  camera: { x: number; y: number; zoom: number; rotation: Rotation },
  viewport: { width: number; height: number },
  size: number,
  snapCorners: boolean,
): LandSelection | null {
  const tile = pickTile(screenX, screenY, map, camera, viewport);
  if (!tile) return null;
  const [cursorX, cursorY] = tile;
  let corners = WHOLE_TILE;
  if (size === 1 && snapCorners) {
    const [fx, fy] = tileFraction(screenX, screenY, tile, map, camera, viewport);
    let nearest = 0;
    let nearestDistance = Infinity;
    CORNERS.forEach(([cx, cy], c) => {
      const d = Math.hypot(fx - cx, fy - cy);
      if (d < nearestDistance) {
        nearestDistance = d;
        nearest = c;
      }
    });
    if (nearestDistance < CORNER_REACH) corners = 1 << nearest;
    else {
      const gaps = [fy, 1 - fx, 1 - fy, fx];
      const edge = gaps.indexOf(Math.min(...gaps));
      if (gaps[edge] < EDGE_REACH) corners = EDGES[edge];
    }
  }
  const origin = Math.floor((size - 1) / 2);
  return {
    x: cursorX - origin,
    y: cursorY - origin,
    width: size,
    height: size,
    corners,
    cursorX,
    cursorY,
  };
}
