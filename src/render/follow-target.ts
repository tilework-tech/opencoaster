import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import { RIDE_INFO_STRIDE, RideInfo, SNAPSHOT_STRIDE } from '../worker/snapshot';
import type { Snapshot } from '../worker/snapshot';
import type { Rotation } from './projection';
import { project } from './projection';

export type FollowTarget =
  { kind: 'guest'; id: number } | { kind: 'staff'; id: number } | { kind: 'ride'; id: number };

export interface FollowPosition {
  x: number;
  y: number;
  z: number;
}

export function cameraForFollowPosition(
  position: FollowPosition,
  mapWidth: number,
  mapHeight: number,
  zoom: number,
  rotation: Rotation = 0,
): { x: number; y: number; zoom: number; rotation: Rotation } {
  const projected = new Float64Array(2);
  project(position.x, position.y, position.z, mapWidth, mapHeight, rotation, projected);
  return { x: projected[0]!, y: projected[1]!, zoom, rotation };
}

/** Resolves a stable entity ID to its latest fixed-point world position. */
export function resolveFollowTarget(
  snapshot: Snapshot | null,
  target: FollowTarget,
): FollowPosition | null {
  if (!snapshot) return null;
  if (target.kind === 'guest' || target.kind === 'staff') {
    const ids = target.kind === 'guest' ? snapshot.guestIds : snapshot.staffIds;
    const layer = target.kind === 'guest' ? snapshot.guests : snapshot.staff;
    const slot = ids.indexOf(target.id);
    if (slot < 0 || slot >= layer.count) return null;
    const offset = slot * SNAPSHOT_STRIDE;
    return {
      x: layer.data[offset] ?? 0,
      y: layer.data[offset + 1] ?? 0,
      z: layer.data[offset + 2] ?? 0,
    };
  }

  const count = Math.min(
    snapshot.rides.count,
    Math.floor(snapshot.rideInfo.length / RIDE_INFO_STRIDE),
  );
  for (let slot = 0; slot < count; slot++) {
    const offset = slot * RIDE_INFO_STRIDE;
    if (snapshot.rideInfo[offset + RideInfo.Id] !== target.id) continue;
    return {
      x: (snapshot.rideInfo[offset + RideInfo.RideX] ?? 0) * TILE_UNITS + TILE_UNITS / 2,
      y: (snapshot.rideInfo[offset + RideInfo.RideY] ?? 0) * TILE_UNITS + TILE_UNITS / 2,
      z: (snapshot.rideInfo[offset + RideInfo.BaseLevel] ?? 0) * Z_STEP,
    };
  }
  return null;
}

export function parseFollowTarget(value: string): FollowTarget | null {
  const [kind, rawId, ...extra] = value.split(':');
  if (extra.length || (kind !== 'guest' && kind !== 'staff' && kind !== 'ride')) return null;
  const id = Number(rawId);
  return Number.isSafeInteger(id) && id >= 0 ? { kind, id } : null;
}
