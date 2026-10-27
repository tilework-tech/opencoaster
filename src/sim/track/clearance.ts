import { TILE_UNITS, TRACK_Z_STEP, Z_STEP } from '../core/constants';
import { PIECES, SAMPLES } from './catalog';

/** The per-tile terrain arrays of `TileMap` and of the renderer's `MapData`. */
export interface TerrainTiles {
  width: number;
  height: number;
  /** Lowest corner level of each tile. */
  heights: ArrayLike<number>;
  /** Bit c set when corner c, ordered (x,y), (x+1,y), (x+1,y+1), (x,y+1), is one level higher. */
  slope: ArrayLike<number>;
}

/**
 * Slack, in z units, between a centre line sample and the ground it rests on. Integer rounding of
 * the interpolated ground and of the piece curves can differ by a unit or two on a ramp that the
 * track follows exactly.
 */
export const CLEARANCE_SLACK = 2;

/** Ground height in z units at a fixed-point position, interpolated across the tile's corners. */
export function groundHeightAt(terrain: TerrainTiles, xu: number, yu: number): number {
  const maxX = terrain.width * TILE_UNITS - 1;
  const maxY = terrain.height * TILE_UNITS - 1;
  const px = xu < 0 ? 0 : xu > maxX ? maxX : xu;
  const py = yu < 0 ? 0 : yu > maxY ? maxY : yu;
  const tile = (py >> 8) * terrain.width + (px >> 8);
  const base = terrain.heights[tile]!;
  const bits = terrain.slope[tile]!;
  const fx = px & 255;
  const fy = py & 255;
  const c0 = base + (bits & 1);
  const c1 = base + ((bits >> 1) & 1);
  const c2 = base + ((bits >> 2) & 1);
  const c3 = base + ((bits >> 3) & 1);
  const top = c0 * (256 - fx) + c1 * fx;
  const bottom = c3 * (256 - fx) + c2 * fx;
  return ((top * (256 - fy) + bottom * fy) * Z_STEP) >> 16;
}

/** World position, in fixed-point units, of a centre line sample of a placed piece. */
function samplePoint(
  sample: number,
  x: number,
  y: number,
  z: number,
  dir: number,
): readonly [number, number, number] {
  const half = TILE_UNITS / 2;
  const lx = SAMPLES.x[sample]! - half;
  const ly = SAMPLES.y[sample]! - half;
  const [rx, ry] =
    (dir & 3) === 0
      ? [lx, ly]
      : (dir & 3) === 1
        ? [-ly, lx]
        : (dir & 3) === 2
          ? [-lx, -ly]
          : [ly, -lx];
  return [
    x * TILE_UNITS + half + rx,
    y * TILE_UNITS + half + ry,
    z * TRACK_Z_STEP + SAMPLES.z[sample]!,
  ];
}

function tileOf(terrain: TerrainTiles, xu: number, yu: number): number {
  const tx = Math.min(terrain.width - 1, Math.max(0, xu >> 8));
  const ty = Math.min(terrain.height - 1, Math.max(0, yu >> 8));
  return ty * terrain.width + tx;
}

/**
 * Tile indices (y * width + x) where a piece placed at (`x`, `y`, `z`) turned `dir` quarter turns
 * has its centre line below the ground, at any sample along the piece including both ends.
 * `z` is in track steps (TRACK_Z_STEP), as in a placement command.
 */
export function undergroundTiles(
  terrain: TerrainTiles,
  pieceType: number,
  x: number,
  y: number,
  z: number,
  dir: number,
): number[] {
  const piece = PIECES[pieceType]!;
  const out: number[] = [];
  for (let k = piece.sampleStart; k < piece.sampleStart + piece.sampleCount; k++) {
    const [xu, yu, zu] = samplePoint(k, x, y, z, dir);
    if (zu + CLEARANCE_SLACK < groundHeightAt(terrain, xu, yu)) {
      const tile = tileOf(terrain, xu, yu);
      if (!out.includes(tile)) out.push(tile);
    }
  }
  return out;
}

/** A place where track passes through the terrain surface, with the portal that marks it. */
export interface TunnelPortal {
  /** Fixed-point world position of the mouth, and the track height there in z units. */
  x: number;
  y: number;
  z: number;
  /** World direction the open side of the portal faces (0 = +x, 1 = +y, 2 = -x, 3 = -y). */
  facing: number;
  /** True where track enters the ground, false where it comes out. */
  entering: boolean;
}

function headingOf(dx: number, dy: number): number {
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 0 : 2) : dy >= 0 ? 1 : 3;
}

/**
 * Portals of one placed piece: one wherever its centre line goes from above the ground to below
 * it, or back out. A piece boundary is never a transition, since neighbours share the boundary
 * sample.
 */
export function pieceTunnelPortals(
  terrain: TerrainTiles,
  pieceType: number,
  x: number,
  y: number,
  z: number,
  dir: number,
): TunnelPortal[] {
  const piece = PIECES[pieceType]!;
  const out: TunnelPortal[] = [];
  let previous: readonly [number, number, number] | null = null;
  let previousGap = 0;
  for (let k = piece.sampleStart; k < piece.sampleStart + piece.sampleCount; k++) {
    const point = samplePoint(k, x, y, z, dir);
    const gap = point[2] - groundHeightAt(terrain, point[0], point[1]);
    if (previous) {
      const wasUnder = previousGap < -CLEARANCE_SLACK;
      const isUnder = gap < -CLEARANCE_SLACK;
      if (wasUnder !== isUnder) {
        const t = Math.abs(previousGap) / (Math.abs(previousGap) + Math.abs(gap) || 1);
        const heading = headingOf(point[0] - previous[0], point[1] - previous[1]);
        out.push({
          x: Math.round(previous[0] + (point[0] - previous[0]) * t),
          y: Math.round(previous[1] + (point[1] - previous[1]) * t),
          z: Math.round(previous[2] + (point[2] - previous[2]) * t),
          facing: isUnder ? (heading + 2) & 3 : heading,
          entering: isUnder,
        });
      }
    }
    previous = point;
    previousGap = gap;
  }
  return out;
}

/** First tile index of `undergroundTiles`, or -1 when the whole piece is above ground. */
export function undergroundTile(
  terrain: TerrainTiles,
  pieceType: number,
  x: number,
  y: number,
  z: number,
  dir: number,
): number {
  return undergroundTiles(terrain, pieceType, x, y, z, dir)[0] ?? -1;
}
