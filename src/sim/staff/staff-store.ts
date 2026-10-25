import type { World } from '../core/world';
import { TILE_UNITS } from '../core/constants';

export const STAFF_WAGE_CENTS_PER_MONTH = [5_000, 8_000, 6_000, 5_500] as const;
export const STAFF_WAGE_CENTS_PER_WEEK = STAFF_WAGE_CENTS_PER_MONTH.map((monthly) =>
  Math.round((monthly * 12) / 52),
);

export function calculateStaffWageBill(w: World): number {
  let total = 0;
  for (let i = 0; i < w.staff.count; i++)
    total += STAFF_WAGE_CENTS_PER_WEEK[w.staff.cols.kind[i]] ?? 0;
  return total;
}

export const enum StaffKind {
  Handyman = 0,
  Mechanic = 1,
  Security = 2,
  Entertainer = 3,
}

export const enum StaffOrder {
  SweepPaths = 0,
  EmptyBins = 1,
  WaterGardens = 2,
  InspectRides = 3,
  RepairRides = 4,
  WatchForVandalism = 5,
  EntertainGuests = 6,
}

export type StaffOrderId =
  | 'sweep-paths'
  | 'empty-bins'
  | 'water-gardens'
  | 'inspect-rides'
  | 'repair-rides'
  | 'watch-for-vandalism'
  | 'entertain-guests';

const STAFF_ORDER_IDS: readonly StaffOrderId[] = [
  'sweep-paths',
  'empty-bins',
  'water-gardens',
  'inspect-rides',
  'repair-rides',
  'watch-for-vandalism',
  'entertain-guests',
];

const STAFF_ORDERS_BY_KIND: readonly (readonly StaffOrder[])[] = [
  [StaffOrder.SweepPaths, StaffOrder.EmptyBins, StaffOrder.WaterGardens],
  [StaffOrder.InspectRides, StaffOrder.RepairRides],
  [StaffOrder.WatchForVandalism],
  [StaffOrder.EntertainGuests],
];

export function staffOrdersForKind(kind: number): readonly StaffOrder[] {
  return STAFF_ORDERS_BY_KIND[kind] ?? [];
}

export function defaultStaffOrderFlags(kind: number): number {
  return staffOrdersForKind(kind).reduce((flags, order) => flags | (1 << order), 0);
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
  orderFlags: Uint8Array,
  sweeps: Uint16Array,
  vandalsStopped: Uint16Array,
} as const;

export function spawnStaff(w: World, kind: number): boolean {
  if (!Number.isInteger(kind) || kind < StaffKind.Handyman || kind > StaffKind.Entertainer)
    return false;
  const s = w.staff;
  const slot = s.spawn();
  if (slot < 0) return false;
  const tx = w.rng.int(w.map.width);
  const ty = w.rng.int(w.map.height);
  s.cols.x[slot] = tx * TILE_UNITS + (TILE_UNITS >> 1);
  s.cols.y[slot] = ty * TILE_UNITS + (TILE_UNITS >> 1);
  s.cols.z[slot] = w.map.heightAt(s.cols.x[slot], s.cols.y[slot]);
  s.cols.targetX[slot] = tx;
  s.cols.targetY[slot] = ty;
  s.cols.kind[slot] = kind;
  s.cols.state[slot] = 0;
  s.cols.orderFlags[slot] = defaultStaffOrderFlags(kind);
  s.cols.sweeps[slot] = 0;
  s.cols.vandalsStopped[slot] = 0;
  const patrolOffset = kind * w.map.width * w.map.height;
  for (let tile = 0; tile < w.map.width * w.map.height; tile++) {
    if (w.patrolAreas[patrolOffset + tile] !== 0) {
      s.cols.patrolArea[slot] = kind + 1;
      break;
    }
  }
  w.economy.inputs.wageBillPerWeek += STAFF_WAGE_CENTS_PER_WEEK[kind] ?? 0;
  return true;
}

export function setStaffOrder(
  w: World,
  staffId: number,
  orderId: StaffOrderId,
  enabled: boolean,
): boolean {
  const slot = w.staff.idToSlot[staffId] ?? -1;
  if (slot < 0) return false;
  const order = STAFF_ORDER_IDS.indexOf(orderId);
  if (order < 0 || !staffOrdersForKind(w.staff.cols.kind[slot]).includes(order)) return false;
  const bit = 1 << order;
  if (enabled) w.staff.cols.orderFlags[slot] |= bit;
  else w.staff.cols.orderFlags[slot] &= ~bit;
  return true;
}

export function staffOrderEnabled(w: World, staffId: number, order: StaffOrder): boolean {
  const slot = w.staff.idToSlot[staffId] ?? -1;
  return slot >= 0 && (w.staff.cols.orderFlags[slot] & (1 << order)) !== 0;
}

export function hireStaff(w: World, kind: number): boolean {
  return spawnStaff(w, kind);
}

export function fireStaff(w: World, staffId: number): boolean {
  const slot = w.staff.idToSlot[staffId] ?? -1;
  if (slot < 0) return false;
  w.economy.inputs.wageBillPerWeek -= STAFF_WAGE_CENTS_PER_WEEK[w.staff.cols.kind[slot]] ?? 0;
  w.staff.despawnSlot(slot);
  w.staffNames.delete(staffId);
  return true;
}

export const MAX_STAFF_NAME_LENGTH = 24;

/** Names are trimmed and whitespace-collapsed; an empty name removes the player's name. */
export function renameStaff(w: World, staffId: number, name: string): boolean {
  if (w.staff.idToSlot[staffId] === undefined || w.staff.idToSlot[staffId] < 0) return false;
  const cleaned = name.replace(/\s+/g, ' ').trim().slice(0, MAX_STAFF_NAME_LENGTH);
  if (cleaned.length === 0) w.staffNames.delete(staffId);
  else w.staffNames.set(staffId, cleaned);
  return true;
}

export function setStaffPatrolTile(
  w: World,
  staffId: number,
  x: number,
  y: number,
  enabled: boolean,
): boolean {
  const slot = w.staff.idToSlot[staffId] ?? -1;
  if (slot < 0 || !w.map.inBounds(x, y)) return false;
  if (w.staff.cols.patrolArea[slot] === 0)
    w.staff.cols.patrolArea[slot] = w.staff.cols.kind[slot] + 1;
  const area = w.staff.cols.patrolArea[slot];
  const offset = (area - 1) * w.map.width * w.map.height + w.map.index(x, y);
  w.patrolAreas[offset] = enabled ? 1 : 0;
  return true;
}

export function setStaffKindPatrolTile(
  w: World,
  kind: number,
  x: number,
  y: number,
  enabled: boolean,
): boolean {
  if (
    !Number.isInteger(kind) ||
    kind < StaffKind.Handyman ||
    kind > StaffKind.Entertainer ||
    !w.map.inBounds(x, y)
  )
    return false;
  const area = kind + 1;
  const tile = w.map.index(x, y);
  const offset = (area - 1) * w.map.width * w.map.height + tile;
  w.patrolAreas[offset] = enabled ? 1 : 0;
  let hasPatrol = false;
  const start = (area - 1) * w.map.width * w.map.height;
  for (let i = 0; i < w.map.width * w.map.height; i++) {
    if (w.patrolAreas[start + i] !== 0) {
      hasPatrol = true;
      break;
    }
  }
  for (let slot = 0; slot < w.staff.count; slot++) {
    if (w.staff.cols.kind[slot] === kind) w.staff.cols.patrolArea[slot] = hasPatrol ? area : 0;
  }
  return true;
}
