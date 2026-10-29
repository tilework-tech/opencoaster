import { PIECES } from '../sim/track/catalog';
import { rotateTile } from '../sim/track/construction';
import { Surface } from '../sim/map/tile-map';
import { DEFAULT_SUPPORT_LEVELS, RIDE_CATALOG } from '../sim/rides/ride-types';
import { RideType } from '../sim/rides/ride-types';
import { DEFAULT_TOWER_HEIGHT, TOWER_SECTION_COST } from '../sim/rides/observation-tower';
import { occupancyConflict, ridePlacementOccupancies } from '../sim/map/occupancy';
import { rideFootprintContains, rideFootprintTiles } from '../sim/rides/ride-footprint';
import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import { SNAPSHOT_STRIDE, RIDE_INFO_STRIDE, RideInfo } from '../worker/snapshot';
import type { Snapshot } from '../worker/snapshot';
import type { MapData } from './renderer';

/**
 * Height level of the floor of a ride placed here: the highest ground under its footprint. A
 * tile's `slope` mask marks the corners raised one level above its base height.
 */
export function ridePlacementLevel(
  type: RideType,
  x: number,
  y: number,
  dir: number,
  map: MapData,
): number {
  const definition = RIDE_CATALOG[type];
  let top = 0;
  for (const [tx, ty] of rideFootprintTiles(definition, x, y, dir)) {
    if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
    const tile = ty * map.width + tx;
    top = Math.max(top, map.heights[tile] + (map.slope[tile] !== 0 ? 1 : 0));
  }
  return top;
}

/** Mirrors ride creation checks so the sprite preview only marks successful placements as valid. */
export function ridePlacementValid(
  type: RideType,
  x: number,
  y: number,
  dir: number,
  map: MapData,
  snapshot: Snapshot,
  towerHeight = DEFAULT_TOWER_HEIGHT,
): boolean {
  const definition = RIDE_CATALOG[type];
  const cost =
    (definition?.cost ?? 0) +
    (type === RideType.ObservationTower
      ? (towerHeight - DEFAULT_TOWER_HEIGHT) * TOWER_SECTION_COST
      : 0);
  if (!definition || snapshot.park.cash < cost) return false;

  const tiles = rideFootprintTiles(definition, x, y, dir);
  let low = Infinity;
  let high = -Infinity;
  for (const [tx, ty] of tiles) {
    if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false;
    const tile = ty * map.width + tx;
    const surface = map.surface[tile];
    if (
      snapshot.buildable[tile] !== 1 ||
      surface === Surface.Path ||
      surface === Surface.Queue ||
      surface === Surface.Water
    ) {
      return false;
    }
    low = Math.min(low, map.heights[tile]);
    high = Math.max(high, map.heights[tile] + (map.slope[tile] !== 0 ? 1 : 0));
  }
  if (high - low > (definition.supportLevels ?? DEFAULT_SUPPORT_LEVELS)) return false;

  if (type === RideType.ObservationTower) {
    const occupied = ridePlacementOccupancies(type, x, y, dir, high * Z_STEP, towerHeight);
    if (
      occupied.some((candidate) =>
        snapshot.occupancies.some((existing) => occupancyConflict(candidate, existing)),
      )
    )
      return false;
  }

  const scenery = map.sceneryElements;
  for (let element = 0; element < (map.sceneryCount ?? 0); element++) {
    const sx = scenery![element * 5];
    const sy = scenery![element * 5 + 1];
    if (tiles.some(([tx, ty]) => tx === sx && ty === sy)) return false;
  }

  for (let existing = 0; existing < snapshot.rides.count; existing++) {
    const offset = existing * RIDE_INFO_STRIDE;
    const existingDefinition = RIDE_CATALOG[snapshot.rideInfo[offset + RideInfo.Type] as RideType];
    if (!existingDefinition) continue;
    const existingX = snapshot.rideInfo[offset + RideInfo.RideX];
    const existingY = snapshot.rideInfo[offset + RideInfo.RideY];
    const existingDir = snapshot.rideInfo[offset + RideInfo.Dir];
    for (const [tx, ty] of tiles) {
      if (rideFootprintContains(existingDefinition, existingX, existingY, existingDir, tx, ty))
        return false;
    }
  }

  for (let existing = 0; existing < snapshot.tracks.count; existing++) {
    const offset = existing * SNAPSHOT_STRIDE;
    const trackX = Math.floor(snapshot.tracks.data[offset] / TILE_UNITS);
    const trackY = Math.floor(snapshot.tracks.data[offset + 1] / TILE_UNITS);
    const packed = snapshot.tracks.data[offset + 3];
    const piece = PIECES[packed & 0xff];
    if (!piece) continue;
    const direction = (packed >>> 8) & 0xff;
    for (const cell of piece.footprint) {
      const [otherDx, otherDy] = rotateTile(cell.i, cell.j, direction);
      if (tiles.some(([tx, ty]) => tx === trackX + otherDx && ty === trackY + otherDy))
        return false;
    }
  }

  return true;
}
