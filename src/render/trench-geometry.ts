import { Z_STEP } from '../sim/core/constants';
import { terrainMeshTriangles, terrainTileCorners } from './terrain-geometry';
import type { TerrainCorner } from './terrain-geometry';
import type { TrenchTile } from '../sim/track/trench';

/** A point in tile units (x, y) and levels (height). */
export type TrenchPoint = TerrainCorner;

/** Half the width of the cut, in tiles: the track and its sleepers sit well inside it. */
export const TRENCH_HALF_WIDTH = 96 / 256;
/** How far, in tiles, the walls and the floor reach past the cut so no crack shows between them and the ground. */
export const TRENCH_EDGE_OVERLAP = 1 / 256;
/** How far the floor lies below the track centre line, in z units, once the cut is deep enough. */
export const TRENCH_FLOOR_BELOW = 4;
/** Number of strips a wall is split into so each has a level bottom (WebGL face meshes). */
export const TRENCH_WALL_STRIPS = 8;

/** Pixel sizes of the trench textures in the atlas: the wall and the arch headwall. */
export const TRENCH_WALL_TEXTURE_HEIGHT = 32;
export const TRENCH_WALL_TEXTURE_WIDTH = 32;
export const TRENCH_ARCH_TEXTURE_WIDTH = 96;
export const TRENCH_ARCH_TEXTURE_HEIGHT = 64;
/** Height of the arch texture, in levels: it stands on the floor. */
export const TRENCH_ARCH_LEVELS = 1;
/** Brightness of a wall or headwall by whether it faces the lit side of the view. */
export const TRENCH_WALL_LIT = 1;
export const TRENCH_WALL_DARK = 0.84;
export const TRENCH_HEAD_LIT = 1;
export const TRENCH_HEAD_DARK = 0.8;

export type TrenchFaceKind = 'floor' | 'wall' | 'head';

/**
 * A planar quad of the trench: `top` edge start to end, then the `bottom` edge end to start in
 * the same order, so a wall is `top[0], top[1], bottom[1], bottom[0]`. A floor lists its low-end
 * edge as `top` and its high-end edge as `bottom`.
 */
export interface TrenchFace {
  kind: TrenchFaceKind;
  /** Which wall of the trench (-1 low side, +1 high side across the axis); 0 otherwise. */
  side: -1 | 0 | 1;
  /** Which end carries the headwall: -1 low end, +1 high end; 0 otherwise. */
  end: -1 | 0 | 1;
  top: [TrenchPoint, TrenchPoint];
  bottom: [TrenchPoint, TrenchPoint];
}

/** Height of the terrain mesh drawn for `rotation` at a point of a tile, in levels. */
export function surfaceHeight(
  corners: readonly TerrainCorner[],
  rotation: number,
  x: number,
  y: number,
): number {
  for (const triangle of terrainMeshTriangles(rotation)) {
    const [a, b, c] = triangle.map((k) => corners[k]!) as [
      TerrainCorner,
      TerrainCorner,
      TerrainCorner,
    ];
    const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    const wa = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / det;
    const wb = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / det;
    const wc = 1 - wa - wb;
    const e = -1e-9;
    if (wa >= e && wb >= e && wc >= e) return wa * a.height + wb * b.height + wc * c.height;
  }
  return corners[0]!.height;
}

/** Floor height, in levels, at an end of a trench tile. */
function floorLevel(z: number, depth: number): number {
  return (z - Math.min(TRENCH_FLOOR_BELOW, Math.max(0, depth))) / Z_STEP;
}

/** The point at `along` (tiles from the tile's low edge) and `across` (from the centre line). */
function pointAt(
  tile: TrenchTile,
  tx: number,
  ty: number,
  along: number,
  across: number,
  h: number,
) {
  return tile.axis === 0
    ? { x: tx + along, y: ty + 0.5 + across, height: h }
    : { x: tx + 0.5 + across, y: ty + along, height: h };
}

/**
 * The cut of one trench tile: the floor, the two retaining walls, and the headwall at each end
 * that has one. Heights of wall tops are those of the terrain mesh drawn at `rotation`.
 */
export function trenchFaces(
  tile: TrenchTile,
  tileX: number,
  tileY: number,
  baseHeight: number,
  slopeMask: number,
  rotation: number,
): TrenchFace[] {
  const corners = terrainTileCorners(tileX, tileY, baseHeight, slopeMask);
  const lowFloor = floorLevel(tile.lowZ, tile.lowDepth);
  const highFloor = floorLevel(tile.highZ, tile.highDepth);
  const ground = (along: number, across: number): number => {
    const p = pointAt(tile, tileX, tileY, along, across, 0);
    return surfaceHeight(corners, rotation, p.x, p.y);
  };
  const at = (along: number, across: number, h: number) =>
    pointAt(tile, tileX, tileY, along, across, h);
  const faces: TrenchFace[] = [
    {
      kind: 'floor',
      side: 0,
      end: 0,
      top: [at(0, -TRENCH_HALF_WIDTH, lowFloor), at(0, TRENCH_HALF_WIDTH, lowFloor)],
      bottom: [at(1, -TRENCH_HALF_WIDTH, highFloor), at(1, TRENCH_HALF_WIDTH, highFloor)],
    },
  ];
  for (const side of [-1, 1] as const) {
    const across = side * TRENCH_HALF_WIDTH;
    faces.push({
      kind: 'wall',
      side,
      end: 0,
      top: [at(0, across, ground(0, across)), at(1, across, ground(1, across))],
      bottom: [at(0, across, lowFloor), at(1, across, highFloor)],
    });
  }
  for (const end of [-1, 1] as const) {
    if (!(end < 0 ? tile.lowHead : tile.highHead)) continue;
    const along = end < 0 ? 0 : 1;
    const floor = end < 0 ? lowFloor : highFloor;
    faces.push({
      kind: 'head',
      side: 0,
      end,
      top: [
        at(along, -TRENCH_HALF_WIDTH, ground(along, -TRENCH_HALF_WIDTH)),
        at(along, TRENCH_HALF_WIDTH, ground(along, TRENCH_HALF_WIDTH)),
      ],
      bottom: [at(along, -TRENCH_HALF_WIDTH, floor), at(along, TRENCH_HALF_WIDTH, floor)],
    });
  }
  return faces;
}

/** Splits a wall into `TRENCH_WALL_STRIPS` strips, each with a bottom as low as its lower end. */
export function wallStrips(wall: TrenchFace): TrenchFace[] {
  const lerp = (a: TrenchPoint, b: TrenchPoint, t: number): TrenchPoint => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    height: a.height + (b.height - a.height) * t,
  });
  const out: TrenchFace[] = [];
  for (let i = 0; i < TRENCH_WALL_STRIPS; i++) {
    const t0 = i / TRENCH_WALL_STRIPS;
    const t1 = (i + 1) / TRENCH_WALL_STRIPS;
    const top: [TrenchPoint, TrenchPoint] = [
      lerp(wall.top[0], wall.top[1], t0),
      lerp(wall.top[0], wall.top[1], t1),
    ];
    const b0 = lerp(wall.bottom[0], wall.bottom[1], t0);
    const b1 = lerp(wall.bottom[0], wall.bottom[1], t1);
    const low = Math.min(b0.height, b1.height);
    out.push({
      ...wall,
      top,
      bottom: [
        { ...b0, height: low },
        { ...b1, height: low },
      ],
    });
  }
  return out;
}

/**
 * The terrain surface of a trench tile with the cut removed, as triangles (each three points):
 * the two mesh triangles of the tile clipped to the two bands either side of the cut.
 */
export function trenchSurfaceTriangles(
  tile: TrenchTile,
  tileX: number,
  tileY: number,
  baseHeight: number,
  slopeMask: number,
  rotation: number,
): [TrenchPoint, TrenchPoint, TrenchPoint][] {
  const corners = terrainTileCorners(tileX, tileY, baseHeight, slopeMask);
  const centre = tile.axis === 0 ? tileY + 0.5 : tileX + 0.5;
  const coordinate = (p: TrenchPoint): number => (tile.axis === 0 ? p.y : p.x);
  const out: [TrenchPoint, TrenchPoint, TrenchPoint][] = [];
  for (const triangle of terrainMeshTriangles(rotation)) {
    const base = triangle.map((k) => corners[k]!);
    for (const side of [-1, 1]) {
      const limit = centre + side * TRENCH_HALF_WIDTH;
      const polygon = clipHalfPlane(base, (p) => side * (coordinate(p) - limit));
      for (let i = 1; i + 1 < polygon.length; i++)
        out.push([polygon[0]!, polygon[i]!, polygon[i + 1]!]);
    }
  }
  return out;
}

/** Keeps the part of a convex polygon where `signed(p) >= 0`. */
function clipHalfPlane(
  polygon: readonly TrenchPoint[],
  signed: (p: TrenchPoint) => number,
): TrenchPoint[] {
  const out: TrenchPoint[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const sa = signed(a);
    const sb = signed(b);
    if (sa >= 0) out.push(a);
    if ((sa > 0 && sb < 0) || (sa < 0 && sb > 0)) {
      const t = sa / (sa - sb);
      out.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        height: a.height + (b.height - a.height) * t,
      });
    }
  }
  return out;
}

/** World direction (0 = +x, 1 = +y, 2 = -x, 3 = -y) the open side of a wall or headwall faces. */
export function trenchFaceFacing(trench: TrenchTile, face: TrenchFace): number {
  if (face.kind === 'wall')
    return trench.axis === 0 ? (face.side < 0 ? 1 : 3) : face.side < 0 ? 0 : 2;
  return trench.axis === 0 ? (face.end < 0 ? 0 : 2) : face.end < 0 ? 1 : 3;
}
