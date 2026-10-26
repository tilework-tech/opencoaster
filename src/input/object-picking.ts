import { rideFootprintContains } from '../sim/rides/ride-footprint';
import { RIDE_CATALOG, type RideType } from '../sim/rides/ride-types';
import { RIDE_INFO_STRIDE, RideInfo, SNAPSHOT_STRIDE, type Snapshot } from '../worker/snapshot';

const TILE_UNITS = 256;

export interface SpritePickTarget {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  alphaWidth: number;
  alphaHeight: number;
  /** Row-major alpha values for the unscaled source sprite. */
  alpha: Uint8Array;
}

/** Returns the topmost target with a visible source pixel at this screen position. */
export function pickTopmostSprite(
  targets: readonly SpritePickTarget[],
  screenX: number,
  screenY: number,
): string | null {
  for (let index = targets.length - 1; index >= 0; index--) {
    const target = targets[index]!;
    const localX = screenX - target.x;
    const localY = screenY - target.y;
    if (localX < 0 || localY < 0 || localX >= target.width || localY >= target.height) continue;
    const sourceX = Math.floor((localX / target.width) * target.alphaWidth);
    const sourceY = Math.floor((localY / target.height) * target.alphaHeight);
    if (target.alpha[sourceY * target.alphaWidth + sourceX]! > 0) return target.id;
  }
  return null;
}

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
