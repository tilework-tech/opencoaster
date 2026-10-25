import { World } from '../core/world';
import { placePath } from '../map/paths';
import {
  createRide,
  connectRideQueue,
  placeRideEntranceExit,
  setRideOpen,
} from '../rides/ride-operations';
import type { RideType } from '../rides/ride-types';
import { GUEST_SCHEMA, spawnGuest } from '../guests/guest-store';
import { setParkEntrance } from '../guests/park';

/** Flat, fully owned, dry map so tests can lay paths and rides wherever they like. */
export function flatWorld(size = 24, seed = 5): World {
  const w = new World({ seed, width: size, height: size, maxGuests: 64 });
  prepareFlat(w);
  return w;
}

export function prepareFlat(w: World): void {
  w.map.waterLevel.fill(0);
  w.map.ownership.fill(1);
  w.map.fillFlat(4);
}

/** Guest store arrays in the layout used by saves before heading, navigation, and ride history. */
export function legacyGuestArrays(w: World): ArrayBufferView[] {
  const columnsAbsentFromVersion3 = new Set([
    'heading',
    'approachGap',
    'navGoal',
    'navGap',
    'navSteps',
    'lostTicks',
    'hasMap',
    'visitTicks',
    'ridesTaken',
    'lastRide',
    'rideHistoryCursor',
    'rideHistory0',
    'rideHistory1',
    'rideHistory2',
    'rideHistory3',
  ]);
  const legacyColumns = Object.keys(GUEST_SCHEMA).filter(
    (name) => name !== 'heading' && !columnsAbsentFromVersion3.has(name),
  );
  return [
    ...w.guests.arrays().slice(0, 3),
    ...legacyColumns.map((name) => w.guests.cols[name as keyof typeof GUEST_SCHEMA]),
  ];
}

export function layPath(
  w: World,
  tiles: ReadonlyArray<readonly [number, number]>,
  queue = false,
): void {
  for (const [x, y] of tiles)
    if (!placePath(w.map, { x, y, queue })) throw new Error(`path ${x},${y}`);
}

export function row(y: number, x0: number, x1: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let x = x0; x <= x1; x++) out.push([x, y]);
  return out;
}

/** An open ride/stall at (x, y) whose entrance is `entrance`; the queue (if any) is `queue`. */
export function openRide(
  w: World,
  type: RideType,
  at: readonly [number, number],
  entrance: readonly [number, number],
  exit: readonly [number, number],
  queue: ReadonlyArray<readonly [number, number]> = [],
): number {
  const id = createRide(w, type, at[0], at[1]);
  if (id < 0) throw new Error('createRide');
  if (
    !placeRideEntranceExit(w, id, { x: entrance[0], y: entrance[1] }, { x: exit[0], y: exit[1] })
  ) {
    throw new Error('entrance/exit');
  }
  if (queue.length > 0) {
    const chain = [entrance, ...queue].map(([x, y]) => ({ x, y }));
    if (!connectRideQueue(w, id, chain)) throw new Error('queue');
  }
  if (!setRideOpen(w, id, true)) throw new Error('open');
  return w.rides.idToSlot[id];
}

/** Spawns one guest on tile (x, y) with the given gate; returns its slot. */
export function guestAt(w: World, x: number, y: number): number {
  setParkEntrance(w, x, y);
  if (!spawnGuest(w)) throw new Error('spawnGuest');
  return w.guests.count - 1;
}
