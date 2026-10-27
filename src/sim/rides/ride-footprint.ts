import type { World } from '../core/world';
import { Z_STEP } from '../core/constants';
import type { TileMap } from '../map/tile-map';
import { Surface } from '../map/tile-map';
import { rotateTile } from '../track/construction';
import { RideResult } from './ride-results';
import { DEFAULT_SUPPORT_LEVELS, RIDE_CATALOG } from './ride-types';
import type { RideType, RideTypeDef } from './ride-types';
import {
  firstOccupancyBlocker,
  ridePlacementOccupancies,
  worldOccupancies,
} from '../map/occupancy';

/** Tiles a ride of this type covers when anchored at (`x`, `y`) and turned `dir` quarter turns. */
export function rideFootprintTiles(
  def: RideTypeDef,
  x: number,
  y: number,
  dir: number,
): Array<[number, number]> {
  return def.footprint.map(([dx, dy]) => {
    const [rx, ry] = rotateTile(dx, dy, dir);
    return [x + rx, y + ry];
  });
}

/** True when (`tx`, `ty`) is one of the tiles the ride covers. */
export function rideFootprintContains(
  def: RideTypeDef,
  x: number,
  y: number,
  dir: number,
  tx: number,
  ty: number,
): boolean {
  for (const [dx, dy] of def.footprint) {
    const [rx, ry] = rotateTile(dx, dy, dir);
    if (x + rx === tx && y + ry === ty) return true;
  }
  return false;
}

/** True when (`tx`, `ty`) is covered by the ride in `slot`. */
export function rideCoversTile(world: World, slot: number, tx: number, ty: number): boolean {
  const ride = world.rides.cols;
  const def = RIDE_CATALOG[ride.typeId[slot] as RideType];
  return (
    def !== undefined &&
    rideFootprintContains(def, ride.rideX[slot], ride.rideY[slot], ride.dir[slot], tx, ty)
  );
}

/** Highest ground corner under the footprint: the level the ride floor sits at. */
export function rideBaseLevel(
  map: TileMap,
  def: RideTypeDef,
  x: number,
  y: number,
  dir: number,
): number {
  let top = 0;
  for (const [dx, dy] of def.footprint) {
    const [rx, ry] = rotateTile(dx, dy, dir);
    const tx = x + rx;
    const ty = y + ry;
    if (!map.inBounds(tx, ty)) continue;
    for (let corner = 0; corner < 4; corner++)
      top = Math.max(top, map.cornerHeight(tx, ty, corner));
  }
  return top;
}

/**
 * Whether a ride of `type` may be built with its anchor on (`x`, `y`) turned `dir` quarter turns.
 * Every footprint tile must lie on the map, be owned or have construction rights, be dry, free of
 * paths, scenery, track and other rides, and the ground beneath must not differ in height by more
 * than the ride's supports allow.
 */
export function validateRidePlacement(
  world: World,
  type: RideType,
  x: number,
  y: number,
  dir: number,
): RideResult {
  const def = RIDE_CATALOG[type];
  const map = world.map;
  if (!def || !Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(dir))
    return RideResult.OutOfBounds;
  let low = Infinity;
  let high = -Infinity;
  for (const [dx, dy] of def.footprint) {
    const [rx, ry] = rotateTile(dx, dy, dir);
    const tx = x + rx;
    const ty = y + ry;
    if (!map.inBounds(tx, ty)) return RideResult.OutOfBounds;
    const tile = map.index(tx, ty);
    if (!map.canBuild(tile)) return RideResult.NotOwned;
    const surface = map.surface[tile];
    if (surface === Surface.Water) return RideResult.Underwater;
    if ((surface === Surface.Path || surface === Surface.Queue) && map.pathElement(tile, -1) < 0)
      return RideResult.Blocked;
    for (let corner = 0; corner < 4; corner++) {
      const h = map.cornerHeight(tx, ty, corner);
      if (h < low) low = h;
      if (h > high) high = h;
    }
  }
  if (high - low > (def.supportLevels ?? DEFAULT_SUPPORT_LEVELS)) return RideResult.TooSteep;

  const candidates = ridePlacementOccupancies(type, x, y, dir, high * Z_STEP);
  return firstOccupancyBlocker(candidates, worldOccupancies(world))
    ? RideResult.Blocked
    : RideResult.Ok;
}
