import { rideFootprintContains } from '../sim/rides/ride-footprint';
import { RIDE_CATALOG, type RideType } from '../sim/rides/ride-types';
import { RIDE_INFO_STRIDE, RideInfo, SNAPSHOT_STRIDE, type Snapshot } from '../worker/snapshot';

const TILE_UNITS = 256;

export function findRideIdAtTile(snapshot: Snapshot, tileX: number, tileY: number): number | null {
  for (let i = 0; i < snapshot.rides.count; i++) {
    const offset = i * RIDE_INFO_STRIDE;
    const x = snapshot.rideInfo[offset + RideInfo.RideX];
    const y = snapshot.rideInfo[offset + RideInfo.RideY];
    const type = snapshot.rideInfo[offset + RideInfo.Type] as RideType;
    const definition = RIDE_CATALOG[type];
    const dir = snapshot.rideInfo[offset + RideInfo.Dir];
    if (definition && rideFootprintContains(definition, x, y, dir, tileX, tileY)) {
      return snapshot.rideInfo[offset + RideInfo.Id];
    }
  }

  for (let i = 0; i < snapshot.tracks.count; i++) {
    const offset = i * SNAPSHOT_STRIDE;
    if (Math.floor(snapshot.tracks.data[offset] / TILE_UNITS) !== tileX) continue;
    if (Math.floor(snapshot.tracks.data[offset + 1] / TILE_UNITS) !== tileY) continue;
    return snapshot.tracks.data[offset + 3] >>> 16;
  }

  return null;
}
