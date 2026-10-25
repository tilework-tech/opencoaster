import { PIECES } from '../sim/track/catalog';
import { rotateTile } from '../sim/track/construction';
import { Surface } from '../sim/map/tile-map';
import { RIDE_CATALOG } from '../sim/rides/ride-types';
import type { RideType } from '../sim/rides/ride-types';
import { TILE_UNITS } from '../sim/core/constants';
import { SNAPSHOT_STRIDE, RIDE_INFO_STRIDE, RideInfo } from '../worker/snapshot';
import type { Snapshot } from '../worker/snapshot';
import type { MapData } from './renderer';

/** Mirrors ride creation checks so the sprite preview only marks successful placements as valid. */
export function ridePlacementValid(
  type: RideType,
  x: number,
  y: number,
  map: MapData,
  snapshot: Snapshot,
): boolean {
  const definition = RIDE_CATALOG[type];
  if (!definition || snapshot.park.cash < definition.cost) return false;

  for (const [dx, dy] of definition.footprint) {
    const tx = x + dx;
    const ty = y + dy;
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
  }

  for (let existing = 0; existing < snapshot.rides.count; existing++) {
    const offset = existing * RIDE_INFO_STRIDE;
    const existingType = snapshot.rideInfo[offset + RideInfo.Type] as RideType;
    const existingDefinition = RIDE_CATALOG[existingType];
    if (!existingDefinition) continue;
    const existingX = snapshot.rideInfo[offset + RideInfo.RideX];
    const existingY = snapshot.rideInfo[offset + RideInfo.RideY];
    for (const [dx, dy] of definition.footprint) {
      if (
        existingDefinition.footprint.some(
          ([otherDx, otherDy]) => x + dx === existingX + otherDx && y + dy === existingY + otherDy,
        )
      ) {
        return false;
      }
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
    for (const [dx, dy] of definition.footprint) {
      for (const cell of piece.footprint) {
        const [otherDx, otherDy] = rotateTile(cell.i, cell.j, direction);
        if (x + dx === trackX + otherDx && y + dy === trackY + otherDy) return false;
      }
    }
  }

  return true;
}
