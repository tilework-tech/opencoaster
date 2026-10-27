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
export function samplePoint(
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
  /**
   * False when the mouth is not on a tile edge of level ground that is flat or rises straight
   * away from it: a tunnel may not enter or leave through a corner, a diagonal or sideways slope,
   * or the middle of a tile.
   */
  valid: boolean;
}

/** How far from a tile edge the centre line may meet the ground and still count as at that edge. */
const EDGE_SNAP = (TILE_UNITS * 2) / 5;

/** Corners of a tile, ordered (x,y), (x+1,y), (x+1,y+1), (x,y+1), that lie on the edge facing `dir`. */
const EDGE_CORNERS: readonly (readonly [number, number])[] = [
  [1, 2],
  [2, 3],
  [3, 0],
  [0, 1],
];

const FACING_STEP: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

function headingOf(dx: number, dy: number): number {
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 0 : 2) : dy >= 0 ? 1 : 3;
}

function cornerLevels(terrain: TerrainTiles, tx: number, ty: number): number[] {
  const tile = ty * terrain.width + tx;
  const base = terrain.heights[tile]!;
  const bits = terrain.slope[tile]!;
  return [
    base + (bits & 1),
    base + ((bits >> 1) & 1),
    base + ((bits >> 2) & 1),
    base + ((bits >> 3) & 1),
  ];
}

/**
 * The shape rule for a mouth at tile edge `facing` of the tile (`tx`, `ty`) behind it: the edge
 * and the opposite edge are level and the ground there is no lower than at the edge, at most one
 * level higher.
 */
function mouthAllowed(terrain: TerrainTiles, tx: number, ty: number, facing: number): boolean {
  if (tx < 0 || ty < 0 || tx >= terrain.width || ty >= terrain.height) return false;
  const levels = cornerLevels(terrain, tx, ty);
  const [n1, n2] = EDGE_CORNERS[facing]!;
  const [f1, f2] = EDGE_CORNERS[(facing + 2) & 3]!;
  if (levels[n1] !== levels[n2] || levels[f1] !== levels[f2]) return false;
  const rise = levels[f1]! - levels[n1]!;
  return rise === 0 || rise === 1;
}

/**
 * Portals of one placed piece: one wherever its centre line goes from above the ground to below
 * it, or back out, snapped to the tile edge it crosses. A piece boundary is never a transition,
 * since neighbours share the boundary sample.
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
        const facing = isUnder ? (heading + 2) & 3 : heading;
        out.push(buildPortal(terrain, previous, point, t, facing, isUnder, heading));
      }
    }
    previous = point;
    previousGap = gap;
  }
  return out;
}

function buildPortal(
  terrain: TerrainTiles,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  t: number,
  facing: number,
  entering: boolean,
  heading: number,
): TunnelPortal {
  const crossing = [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
  const axis = heading & 1;
  const edge = Math.round(crossing[axis]! / TILE_UNITS) * TILE_UNITS;
  const onEdge = Math.abs(crossing[axis]! - edge) <= EDGE_SNAP;
  const portal: TunnelPortal = {
    x: Math.round(crossing[0]!),
    y: Math.round(crossing[1]!),
    z: Math.round(crossing[2]!),
    facing,
    entering,
    valid: false,
  };
  if (!onEdge) return portal;
  const span = to[axis]! - from[axis]!;
  const along = span === 0 ? t : (edge - from[axis]!) / span;
  const zEdge = from[2] + (to[2] - from[2]) * Math.min(1, Math.max(0, along));
  const position = [crossing[0]!, crossing[1]!];
  position[axis] = edge;
  portal.x = Math.round(position[0]!);
  portal.y = Math.round(position[1]!);
  portal.z = Math.round(zEdge);
  const [sx, sy] = FACING_STEP[facing]!;
  const behindX = Math.floor((portal.x - sx) / TILE_UNITS);
  const behindY = Math.floor((portal.y - sy) / TILE_UNITS);
  portal.valid = mouthAllowed(terrain, behindX, behindY, facing);
  return portal;
}

/** Depth at which a trench ends in a headwall and the track goes under cover. */
export const ROOF_DEPTH = Z_STEP - CLEARANCE_SLACK;

export function isStraight(pieceType: number): boolean {
  const piece = PIECES[pieceType]!;
  return piece.shape === 'straight' && piece.dx * piece.dx + piece.dy * piece.dy === 1;
}

/** Depth of the centre line below the ground at a fixed-point point (negative above ground). */
export function depthAt(terrain: TerrainTiles, point: readonly [number, number, number]): number {
  return groundHeightAt(terrain, point[0], point[1]) - point[2];
}

/**
 * True when a piece that is not straight lies partly below the ground without being roofed over
 * along its whole length: a trench is cut straight, so a turn or hill may not sit in one.
 */
export function unsoundTrenchPiece(
  terrain: TerrainTiles,
  piece: { pieceType: number; x: number; y: number; z: number; dir: number },
): boolean {
  if (isStraight(piece.pieceType)) return false;
  const def = PIECES[piece.pieceType]!;
  let shallow = false;
  for (let k = def.sampleStart; k < def.sampleStart + def.sampleCount; k++) {
    const depth = depthAt(terrain, samplePoint(k, piece.x, piece.y, piece.z, piece.dir));
    if (depth > CLEARANCE_SLACK && depth < ROOF_DEPTH) shallow = true;
  }
  return shallow;
}

/** True when any tunnel mouth of the piece is not on a tile edge of suitable ground. */
export function badTunnelEntry(
  terrain: TerrainTiles,
  pieceType: number,
  x: number,
  y: number,
  z: number,
  dir: number,
): boolean {
  return (
    pieceTunnelPortals(terrain, pieceType, x, y, z, dir).some((p) => !p.valid) ||
    unsoundTrenchPiece(terrain, { pieceType, x, y, z, dir })
  );
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
