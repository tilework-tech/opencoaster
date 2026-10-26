import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import { terrainMeshTriangles, terrainTileCorners } from './terrain-geometry';

export type Rotation = 0 | 1 | 2 | 3;

export const TILE_W = 64;
export const TILE_H = 32;
/** Screen pixels per height level. */
export const Z_PIXELS = 16;

/** Rotates a tile coordinate into view space for the given quarter-turn count. */
export function rotateTile(
  x: number,
  y: number,
  w: number,
  h: number,
  rot: Rotation,
): [number, number] {
  switch (rot) {
    case 0:
      return [x, y];
    case 1:
      return [h - 1 - y, x];
    case 2:
      return [w - 1 - x, h - 1 - y];
    case 3:
      return [y, w - 1 - x];
  }
}

export function unrotateTile(
  rx: number,
  ry: number,
  w: number,
  h: number,
  rot: Rotation,
): [number, number] {
  switch (rot) {
    case 0:
      return [rx, ry];
    case 1:
      return [ry, h - 1 - rx];
    case 2:
      return [w - 1 - rx, h - 1 - ry];
    case 3:
      return [w - 1 - ry, rx];
  }
}

/** Rotated view-space dimensions. */
export function viewSize(w: number, h: number, rot: Rotation): [number, number] {
  return rot % 2 === 0 ? [w, h] : [h, w];
}

export interface MapExtent {
  width: number;
  height: number;
}

/** Quarter-turn direction index: 0 = +x, 1 = +y, 2 = -x, 3 = -y in world space. */
export type Direction = 0 | 1 | 2 | 3;

/**
 * Continuous rotation of a world position in tile units (tile centre = integer + 0.5) about the
 * map centre. This is the single rotation convention: `rotateTile` is its floor on cell indices.
 */
export function rotatePoint(
  tx: number,
  ty: number,
  w: number,
  h: number,
  rot: Rotation,
): [number, number] {
  switch (rot) {
    case 0:
      return [tx, ty];
    case 1:
      return [h - ty, tx];
    case 2:
      return [w - tx, h - ty];
    case 3:
      return [ty, w - tx];
  }
}

/** Inverse of `rotatePoint`. */
export function unrotatePoint(
  rx: number,
  ry: number,
  w: number,
  h: number,
  rot: Rotation,
): [number, number] {
  switch (rot) {
    case 0:
      return [rx, ry];
    case 1:
      return [ry, h - rx];
    case 2:
      return [w - rx, h - ry];
    case 3:
      return [w - ry, rx];
  }
}

/** Rotates a world-space displacement (tiles); unlike a position it is independent of map size. */
export function rotateOffset(dx: number, dy: number, rot: Rotation): [number, number] {
  switch (rot) {
    case 0:
      return [dx, dy];
    case 1:
      return [-dy, dx];
    case 2:
      return [-dx, -dy];
    case 3:
      return [dy, -dx];
  }
}

/** World direction (0 = +x, 1 = +y, 2 = -x, 3 = -y) as seen from the camera; also the sprite view index of a facing. */
export function rotateDirection(direction: number, rot: Rotation): Direction {
  return ((direction + rot) & 3) as Direction;
}

export interface RotatedFootprint {
  /** Rotated view-space cell of each footprint entry, in footprint order. */
  cells: Array<[number, number]>;
  /** The view-space cell with the smallest (rx, ry), i.e. the footprint's back corner. */
  origin: [number, number];
  /** Back-corner-relative view-space offset of each cell. */
  offsets: Array<[number, number]>;
  /** Continuous view-space centre of the footprint, for sorting and sprite placement. */
  centre: [number, number];
}

/**
 * Rotates a multi-tile footprint (anchor tile plus world offsets) about the map, not about its own
 * origin, so the object's cells stay where the map puts them in every view.
 */
export function rotateFootprint(
  anchorX: number,
  anchorY: number,
  footprint: ReadonlyArray<readonly [number, number]>,
  w: number,
  h: number,
  rot: Rotation,
): RotatedFootprint {
  const cells = footprint.map(
    ([dx, dy]) => rotateTile(anchorX + dx, anchorY + dy, w, h, rot) as [number, number],
  );
  if (cells.length === 0) cells.push(rotateTile(anchorX, anchorY, w, h, rot));
  const minRx = Math.min(...cells.map((c) => c[0]));
  const minRy = Math.min(...cells.map((c) => c[1]));
  const maxRx = Math.max(...cells.map((c) => c[0]));
  const maxRy = Math.max(...cells.map((c) => c[1]));
  return {
    cells,
    origin: [minRx, minRy],
    offsets: cells.map(([rx, ry]) => [rx - minRx, ry - minRy] as [number, number]),
    centre: [(minRx + maxRx + 1) / 2, (minRy + maxRy + 1) / 2],
  };
}

/**
 * Projects a world position (tile units, height in levels) to screen pixels relative to the map
 * origin. Continuous: usable for anything between tiles.
 */
export function worldToScreen(
  x: number,
  y: number,
  z: number,
  rot: Rotation,
  map: MapExtent,
): [number, number] {
  const [rx, ry] = rotatePoint(x, y, map.width, map.height, rot);
  return [(rx - ry) * (TILE_W / 2), (rx + ry) * (TILE_H / 2) - z * Z_PIXELS];
}

/** Exact inverse of `worldToScreen` for a known height `z` (levels): the world position (tiles) under a screen point. */
export function screenToWorld(
  sx: number,
  sy: number,
  z: number,
  rot: Rotation,
  map: MapExtent,
): [number, number] {
  const axisX = sx / (TILE_W / 2);
  const axisY = (sy + z * Z_PIXELS) / (TILE_H / 2);
  return unrotatePoint((axisX + axisY) / 2, (axisY - axisX) / 2, map.width, map.height, rot);
}

/**
 * Painter-order depth of a world position (tile units): grows toward the viewer. Painters double
 * it and subtract height in levels so within-tile offsets stay integers.
 */
export function viewDepth(x: number, y: number, rot: Rotation, map: MapExtent): number {
  const [rx, ry] = rotatePoint(x, y, map.width, map.height, rot);
  return rx + ry;
}

/**
 * Projects a fixed-point world position (TILE_UNITS per tile, Z_STEP per level) to screen
 * pixels relative to the map origin. Continuous: usable for entities between tiles.
 */
export function project(
  fx: number,
  fy: number,
  fz: number,
  w: number,
  h: number,
  rot: Rotation,
  out: Float64Array,
): void {
  const [sx, sy] = worldToScreen(fx / TILE_UNITS, fy / TILE_UNITS, fz / Z_STEP, rot, {
    width: w,
    height: h,
  });
  out[0] = sx;
  out[1] = sy;
}

/** Returns the last terrain surface under a viewport-local point in painter order. */
export function pickTile(
  screenX: number,
  screenY: number,
  map: { width: number; height: number; heights: Uint8Array; slope?: Uint8Array },
  camera: { x: number; y: number; zoom: number; rotation: Rotation },
  viewport: { width: number; height: number },
): [number, number] | null {
  if (!Number.isFinite(camera.zoom) || camera.zoom <= 0) return null;

  const worldX = camera.x + (screenX - viewport.width / 2) / camera.zoom;
  const worldY = camera.y + (screenY - viewport.height / 2) / camera.zoom;
  const axisX = worldX / (TILE_W / 2);
  const axisY = worldY / (TILE_H / 2) - 1;
  const centerRx = (axisX + axisY) / 2;
  const centerRy = (axisY - axisX) / 2;
  const [viewW, viewH] = viewSize(map.width, map.height, camera.rotation);
  const estimatedRx = Math.round(centerRx);
  const estimatedRy = Math.round(centerRy);
  let selected: [number, number] | null = null;
  let selectedDepth = Number.NEGATIVE_INFINITY;
  const projected = [
    new Float64Array(2),
    new Float64Array(2),
    new Float64Array(2),
    new Float64Array(2),
  ];

  // Elevation can shift the projected tile by at most half the 31-level map range.
  for (let ry = estimatedRy - 16; ry <= estimatedRy + 16; ry++) {
    for (let rx = estimatedRx - 16; rx <= estimatedRx + 16; rx++) {
      if (rx < 0 || ry < 0 || rx >= viewW || ry >= viewH) continue;
      const [x, y] = unrotateTile(rx, ry, map.width, map.height, camera.rotation);
      const index = y * map.width + x;
      const corners = terrainTileCorners(x, y, map.heights[index]!, map.slope?.[index] ?? 0);
      for (let corner = 0; corner < 4; corner++)
        project(
          corners[corner]!.x * TILE_UNITS,
          corners[corner]!.y * TILE_UNITS,
          corners[corner]!.height * Z_STEP,
          map.width,
          map.height,
          camera.rotation,
          projected[corner]!,
        );
      const triangles = terrainMeshTriangles(camera.rotation);
      for (const triangle of triangles) {
        const a = projected[triangle[0]]!;
        const b = projected[triangle[1]]!;
        const c = projected[triangle[2]]!;
        const ax = viewport.width / 2 + (a[0]! - camera.x) * camera.zoom;
        const ay = viewport.height / 2 + (a[1]! - camera.y) * camera.zoom;
        const bx = viewport.width / 2 + (b[0]! - camera.x) * camera.zoom;
        const by = viewport.height / 2 + (b[1]! - camera.y) * camera.zoom;
        const cx = viewport.width / 2 + (c[0]! - camera.x) * camera.zoom;
        const cy = viewport.height / 2 + (c[1]! - camera.y) * camera.zoom;
        const weights = barycentric(screenX, screenY, ax, ay, bx, by, cx, cy);
        if (!weights || weights.some((weight) => weight < -1e-7)) continue;
        const depth = 2 * (rx + ry) - map.heights[index]!;
        if (depth < selectedDepth) continue;
        selected = [x, y];
        selectedDepth = depth;
      }
    }
  }

  return selected;
}

function barycentric(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): [number, number, number] | null {
  const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(denominator) < 1e-9) return null;
  const a = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denominator;
  const b = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denominator;
  return [a, b, 1 - a - b];
}
