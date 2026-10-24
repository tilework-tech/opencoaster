import type { World } from '../core/world';
import { TILE_UNITS, Z_STEP } from '../core/constants';

export const enum StaffKind {
  Handyman = 0,
  Mechanic = 1,
  Security = 2,
  Entertainer = 3,
}

export const STAFF_SCHEMA = {
  x: Int32Array,
  y: Int32Array,
  z: Int32Array,
  targetX: Int16Array,
  targetY: Int16Array,
  kind: Uint8Array,
  state: Uint8Array,
  patrolArea: Uint16Array,
} as const;

export function spawnStaff(w: World, kind: number): boolean {
  const s = w.staff;
  const slot = s.spawn();
  if (slot < 0) return false;
  const tx = w.rng.int(w.map.width);
  const ty = w.rng.int(w.map.height);
  s.cols.x[slot] = tx * TILE_UNITS + (TILE_UNITS >> 1);
  s.cols.y[slot] = ty * TILE_UNITS + (TILE_UNITS >> 1);
  s.cols.z[slot] = w.map.heights[w.map.index(tx, ty)] * Z_STEP;
  s.cols.targetX[slot] = tx;
  s.cols.targetY[slot] = ty;
  s.cols.kind[slot] = kind;
  return true;
}
