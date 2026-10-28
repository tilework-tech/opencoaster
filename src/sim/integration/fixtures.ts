import { World } from '../core/world';
import { placePath } from '../map/paths';
import {
  createRide,
  connectRideQueue,
  placeRideEntranceExit,
  setRideOpen,
} from '../rides/ride-operations';
import { RIDE_CATALOG } from '../rides/ride-types';
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
    'happinessTarget',
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
    'litterMemory',
    'angriness',
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

/**
 * Anchor tile for an unrotated ride of `type` whose footprint ends at `corner` (its largest x and
 * largest y). A one-tile ride anchors on `corner` itself; larger rides extend towards -x/-y, so the
 * tiles at corner + (0, 1) and corner + (1, 0) are always edge-adjacent to the footprint.
 */
export function anchorForCorner(
  type: RideType,
  corner: readonly [number, number],
): [number, number] {
  let maxX = 0;
  let maxY = 0;
  for (const [dx, dy] of RIDE_CATALOG[type].footprint) {
    maxX = Math.max(maxX, dx);
    maxY = Math.max(maxY, dy);
  }
  return [corner[0] - maxX, corner[1] - maxY];
}

/** A closed ride whose unrotated footprint ends at `corner`; see {@link anchorForCorner}. */
export function createRideAtCorner(
  w: World,
  type: RideType,
  corner: readonly [number, number],
): number {
  const [x, y] = anchorForCorner(type, corner);
  return createRide(w, type, x, y);
}

/**
 * An open ride/stall whose unrotated footprint ends at `at` (see {@link anchorForCorner}), with
 * entrance `entrance`; the queue (if any) is `queue`. */
export function openRide(
  w: World,
  type: RideType,
  at: readonly [number, number],
  entrance: readonly [number, number],
  exit: readonly [number, number],
  queue: ReadonlyArray<readonly [number, number]> = [],
): number {
  const id = createRideAtCorner(w, type, at);
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
