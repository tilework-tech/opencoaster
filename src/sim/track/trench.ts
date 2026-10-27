import { PIECES } from './catalog';
import { CLEARANCE_SLACK, ROOF_DEPTH, depthAt, isStraight, samplePoint } from './clearance';
import type { TerrainTiles } from './clearance';

/** One placed piece, as in a placement command: `z` in track steps. */
export interface TrackPiecePlacement {
  pieceType: number;
  x: number;
  y: number;
  z: number;
  dir: number;
}

/**
 * A tile whose ground is cut away along the track: track below the surface that is not yet
 * covered by enough earth to be a tunnel. Depths are in z units below the ground at the tile
 * edge the track crosses; "low" and "high" are the ends at the smaller and larger coordinate
 * along the axis.
 */
export interface TrenchTile {
  index: number;
  /** 0 when the track runs along x, 1 along y. */
  axis: 0 | 1;
  /** Track centre line height (z units) at the low and high ends. */
  lowZ: number;
  highZ: number;
  lowDepth: number;
  highDepth: number;
  /** Whether the trench ends in a headwall with the tunnel mouth at that end. */
  lowHead: boolean;
  highHead: boolean;
}

/**
 * The trench tiles of a set of placed pieces. Only straight pieces cut a trench; a tile is open
 * while the centre line at either edge is below the ground by less than `ROOF_DEPTH`, and
 * ends in a headwall at an edge where it is that deep.
 */
export function trenchTiles(
  terrain: TerrainTiles,
  pieces: Iterable<TrackPiecePlacement>,
): Map<number, TrenchTile> {
  const out = new Map<number, TrenchTile>();
  for (const { pieceType, x, y, z, dir } of pieces) {
    if (!isStraight(pieceType) || x < 0 || y < 0 || x >= terrain.width || y >= terrain.height)
      continue;
    const piece = PIECES[pieceType]!;
    const first = samplePoint(piece.sampleStart, x, y, z, dir);
    const last = samplePoint(piece.sampleStart + piece.sampleCount - 1, x, y, z, dir);
    const dFirst = depthAt(terrain, first);
    const dLast = depthAt(terrain, last);
    if (Math.max(dFirst, dLast) <= CLEARANCE_SLACK || Math.min(dFirst, dLast) >= ROOF_DEPTH)
      continue;
    const axis = (dir & 1) as 0 | 1;
    const reversed = last[axis]! < first[axis]!;
    const [low, high] = reversed ? [last, first] : [first, last];
    const [lowDepth, highDepth] = reversed ? [dLast, dFirst] : [dFirst, dLast];
    const index = Math.floor(y) * terrain.width + Math.floor(x);
    out.set(index, {
      index,
      axis,
      lowZ: low[2],
      highZ: high[2],
      lowDepth: Math.max(0, lowDepth),
      highDepth: Math.max(0, highDepth),
      lowHead: lowDepth >= ROOF_DEPTH,
      highHead: highDepth >= ROOF_DEPTH,
    });
  }
  return out;
}
