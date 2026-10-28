import type { World } from '../core/world';
import { PATH_FRONT_DIR, PATH_FRONT_KNOWN, PATH_FRONT_SHIFT } from '../map/tile-map';
import { DIR_DX, DIR_DY } from '../pathfinding/directions';
import { PIECES } from '../track/catalog';
import { rotateTile } from '../track/construction';
import { PieceFlag } from '../track/track-types';
import { rideFootprintTiles } from './ride-footprint';
import { RIDE_CATALOG } from './ride-types';
import type { RideType } from './ride-types';

/** Tiles the ride's guests board and leave from: the footprint of a flat ride, station tiles for track rides. */
export function rideBoardingTiles(world: World, slot: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const ride = world.rides.cols;
  const def = RIDE_CATALOG[ride.typeId[slot] as RideType];
  if (!def) return out;
  if (!def.usesTrack) {
    return rideFootprintTiles(def, ride.rideX[slot], ride.rideY[slot], ride.dir[slot]);
  }
  const rideId = world.rides.slotToId[slot];
  const pieces = world.track.pieces;
  for (let s = 0; s < pieces.count; s++) {
    if (pieces.cols.rideId[s] !== rideId) continue;
    const piece = PIECES[pieces.cols.pieceType[s]];
    if (!(piece.flags & PieceFlag.Station)) continue;
    for (const cell of piece.footprint) {
      const [rx, ry] = rotateTile(cell.i, cell.j, pieces.cols.dir[s]);
      out.push([pieces.cols.x[s] + rx, pieces.cols.y[s] + ry]);
    }
  }
  return out;
}

/**
 * Front edge (0..3) of an entrance or exit at (x, y) beside `tiles`: the edge facing away from the
 * ride. Where the tile touches the ride on several sides the lowest direction wins; -1 when it
 * touches none.
 */
export function frontAwayFrom(
  tiles: ReadonlyArray<readonly [number, number]>,
  x: number,
  y: number,
): number {
  const covers = (tx: number, ty: number): boolean =>
    tiles.some(([bx, by]) => bx === tx && by === ty);
  let back = -1;
  let fallback = -1;
  for (let d = 0; d < 4; d++) {
    if (covers(x + DIR_DX[d], y + DIR_DY[d])) {
      if (back < 0 && !covers(x - DIR_DX[d], y - DIR_DY[d])) back = d;
    } else if (fallback < 0) fallback = d;
  }
  return back >= 0 ? (back + 2) & 3 : fallback;
}

/** Writes `front` (0..3, or -1 to clear) as the front edge of the path piece on tile (x, y). */
export function setBoardingFront(world: World, x: number, y: number, front: number): void {
  const map = world.map;
  if (!map.inBounds(x, y)) return;
  const e = map.pathElement(map.index(x, y), -1);
  if (e < 0) return;
  map.elData[e] &= ~(PATH_FRONT_DIR | PATH_FRONT_KNOWN);
  if (front >= 0) map.elData[e] |= PATH_FRONT_KNOWN | (front << PATH_FRONT_SHIFT);
}

/** Faces a ride's placed entrance and exit away from the ride. */
export function faceBoardingAwayFromRide(world: World, slot: number): void {
  const ride = world.rides.cols;
  const tiles = rideBoardingTiles(world, slot);
  if (ride.entrancePlaced[slot]) {
    const x = ride.entranceX[slot];
    const y = ride.entranceY[slot];
    setBoardingFront(world, x, y, frontAwayFrom(tiles, x, y));
  }
  if (ride.exitPlaced[slot]) {
    const x = ride.exitX[slot];
    const y = ride.exitY[slot];
    setBoardingFront(world, x, y, frontAwayFrom(tiles, x, y));
  }
}
