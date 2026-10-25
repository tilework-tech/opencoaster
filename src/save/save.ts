import { World } from '../sim/core/world';
import { EntityStore } from '../sim/core/entity-store';
import type { Schema } from '../sim/core/entity-store';
import { GUEST_SCHEMA, GuestState, HEADING_NONE } from '../sim/guests/guest-store';
import type { ParkState } from '../sim/guests/park';
import { restoreLedger, saveLedger } from '../sim/economy/ledger';
import type { LedgerSave } from '../sim/economy/ledger';
import { restoreResearch, saveResearch, upgradeLegacyResearchSave } from '../sim/research/research';
import type { LegacyResearchSave, ResearchSave } from '../sim/research/research';
import type { ScenarioState } from '../sim/scenario/scenario';
import { calculateStaffWageBill, defaultStaffOrderFlags } from '../sim/staff/staff-store';
import { RIDER_HISTORY_WINDOWS, RIDE_COLUMNS_ADDED_IN_V10 } from '../sim/rides/ride-store';
import { RIDE_CATALOG } from '../sim/rides/ride-types';
import type { RideType } from '../sim/rides/ride-types';
import { RELIABILITY_MAX } from '../sim/rides/ride-maintenance';

export const SAVE_VERSION = 14;
const PREVIOUS_SAVE_VERSION = 13;
const PRE_STAFF_ORDER_SAVE_VERSION = 12;
const PRE_GUEST_STATS_SAVE_VERSION = 11;
const PRE_RIDE_HISTORY_SAVE_VERSION = 12;
/** First version whose research stores invention work units rather than cents. */
const RESEARCH_UNITS_SAVE_VERSION = 10;
const PRE_NAVIGATION_SAVE_VERSION = 9;
const PRE_TRAIN_LAYOUT_SAVE_VERSION = 8;
const PRE_APPROACH_SAVE_VERSION = 8;
const PRE_RELIABILITY_SAVE_VERSION = 10;
const PRE_INCOME_SAVE_VERSION = 7;
const PRE_STAFF_CARE_SAVE_VERSION = 5;
const PRE_RIDES_SAVE_VERSION = 3;
const PRE_HEADING_SAVE_VERSION = 4;

/** Guest columns before `heading` was added (saves up to version 4). */
const LEGACY_GUEST_SCHEMA = Object.fromEntries(
  Object.entries(GUEST_SCHEMA).filter(
    ([name]) =>
      ![
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
      ].includes(name),
  ),
) as Omit<
  typeof GUEST_SCHEMA,
  | 'heading'
  | 'approachGap'
  | 'navGoal'
  | 'navGap'
  | 'navSteps'
  | 'lostTicks'
  | 'hasMap'
  | 'visitTicks'
  | 'ridesTaken'
  | 'lastRide'
  | 'rideHistoryCursor'
  | 'rideHistory0'
  | 'rideHistory1'
  | 'rideHistory2'
  | 'rideHistory3'
>;
const MAGIC = 0x56534f43; // "COSV" little-endian

type StoreName = 'guests' | 'staff' | 'vehicles' | 'litter' | 'rides';
const STORE_NAMES: StoreName[] = ['guests', 'staff', 'vehicles', 'litter', 'rides'];

interface StoreHeader {
  capacity: number;
  count: number;
  freeTop: number;
}

interface Header {
  version: number;
  seed: number;
  width: number;
  height: number;
  tick: number;
  rng: number[];
  stores: Record<string, StoreHeader>;
  economy: LedgerSave;
  weather: { kind: number; temperature: number; ticksUntilChange: number };
  research: ResearchSave;
  scenario: ScenarioState;
  park?: ParkState;
  patrolAreas?: number[];
  umbrellas?: number[];
  grounds?: number[];
  staffNames?: Record<string, string>;
  track: { pieces: StoreHeader; lastResult: number; lastPiece: number };
}

function views(world: World): ArrayBufferView[] {
  const out: ArrayBufferView[] = [...world.map.arrays()];
  for (const n of STORE_NAMES) out.push(...(world[n] as EntityStore<Schema>).arrays());
  out.push(...world.track.pieces.arrays(), ...world.track.rideTables());
  return out;
}

function legacyRideViews(world: World): ArrayBufferView[] {
  const [slotToId, idToSlot, freeIds] = world.rides.arrays();
  const capacity = world.rides.capacity;
  return [
    slotToId,
    idToSlot,
    freeIds,
    new Uint16Array(capacity),
    new Uint8Array(capacity),
    new Int16Array(capacity),
    new Int16Array(capacity),
    new Uint16Array(capacity),
    new Uint16Array(capacity),
    new Uint16Array(capacity),
    new Uint16Array(capacity),
    new Uint16Array(capacity),
    new Uint8Array(capacity),
    new Uint16Array(capacity),
  ];
}

function migrateLegacyRides(world: World, arrays: ArrayBufferView[]): void {
  const typeId = arrays[3] as Uint16Array;
  const entranceX = arrays[5] as Int16Array;
  const entranceY = arrays[6] as Int16Array;
  const excitement = arrays[7] as Uint16Array;
  const intensity = arrays[8] as Uint16Array;
  const nausea = arrays[9] as Uint16Array;
  const price = arrays[10] as Uint16Array;
  const queueLength = arrays[11] as Uint16Array;
  const reliability = arrays[12] as Uint8Array;
  const breakdownCounter = arrays[13] as Uint16Array;
  const rides = world.rides.cols;
  for (let slot = 0; slot < world.rides.count; slot++) {
    rides.typeId[slot] = typeId[slot];
    rides.state[slot] = 0;
    rides.phase[slot] = 0;
    rides.entranceX[slot] = entranceX[slot];
    rides.entranceY[slot] = entranceY[slot];
    rides.excitement[slot] = excitement[slot];
    rides.intensity[slot] = intensity[slot];
    rides.nausea[slot] = nausea[slot];
    rides.price[slot] = price[slot];
    rides.queueLength[slot] = queueLength[slot];
    rides.reliability[slot] = reliability[slot];
    rides.breakdownCounter[slot] = breakdownCounter[slot];
  }
}

function migrateLegacyGuests(
  world: World,
  legacy: EntityStore<typeof LEGACY_GUEST_SCHEMA>,
  count: number,
): void {
  const [slotToId, idToSlot, freeIds] = world.guests.arrays() as Uint32Array[];
  const [legacySlotToId, legacyIdToSlot, legacyFreeIds] = legacy.arrays() as Uint32Array[];
  slotToId.set(legacySlotToId);
  idToSlot.set(legacyIdToSlot);
  freeIds.set(legacyFreeIds);
  for (const key of Object.keys(LEGACY_GUEST_SCHEMA) as (keyof typeof LEGACY_GUEST_SCHEMA)[]) {
    world.guests.cols[key].set(legacy.cols[key]);
  }
  const guests = world.guests.cols;
  guests.heading.fill(HEADING_NONE, 0, count);
  // Earlier versions counted every queuing guest in the ride's queueLength and timed rides per
  // guest; the new model only counts guests at the head of a queue and ties riding to ride cycles.
  for (let slot = 0; slot < count; slot++) {
    if (guests.state[slot] !== GuestState.Queuing && guests.state[slot] !== GuestState.Riding)
      continue;
    guests.state[slot] = GuestState.Wandering;
    guests.targetRide[slot] = -1;
    guests.activityTicks[slot] = 0;
  }
  world.rides.cols.queueLength.fill(0);
}

/** Saves through version 10 stored reliability as a whole percent and had no ride modes. */
function migratePreReliabilityRides(world: World): void {
  const rides = world.rides.cols;
  for (let slot = 0; slot < world.rides.count; slot++) {
    rides.reliabilityRaw[slot] = Math.min(RELIABILITY_MAX, rides.reliability[slot] * 256);
    rides.mode[slot] = RIDE_CATALOG[rides.typeId[slot] as RideType]?.modes[0].mode ?? 0;
  }
}

function migrateGuestHistory(world: World, count: number): void {
  const guests = world.guests.cols;
  for (let slot = 0; slot < count; slot++) {
    guests.hunger[slot] = 255 - guests.hunger[slot];
    guests.thirst[slot] = 255 - guests.thirst[slot];
    const oldTolerance = Math.max(96, Math.min(255, guests.nauseaTolerance[slot]));
    const roll = Math.floor(((oldTolerance - 96) * 8) / 160);
    guests.nauseaTolerance[slot] = roll === 0 ? 0 : roll < 3 ? 1 : roll < 6 ? 2 : 3;
  }
  guests.visitTicks.fill(0, 0, count);
  guests.ridesTaken.fill(0, 0, count);
  guests.lastRide.fill(-1, 0, count);
}

function migrateMissingApproachGap(world: World, count: number): void {
  world.guests.cols.approachGap.fill(0xffff, 0, count);
}

const MAX_SAVED_MAP_SIDE = 512;
const MAX_SAVED_CAPACITY = 65536;

/** Refuses sizes that would allocate unreasonable memory before any column is read. */
function checkHeaderBounds(header: Header): void {
  const inRange = (n: unknown, max: number) =>
    typeof n === 'number' && Number.isSafeInteger(n) && n >= 1 && n <= max;
  if (!inRange(header.width, MAX_SAVED_MAP_SIDE) || !inRange(header.height, MAX_SAVED_MAP_SIDE)) {
    throw new Error('Save has an invalid map size');
  }
  for (const n of STORE_NAMES) {
    if (!inRange(header.stores?.[n]?.capacity, MAX_SAVED_CAPACITY)) {
      throw new Error(`Save has an invalid ${n} capacity`);
    }
  }
}

/** Binary layout: [magic u32][headerLen u32][header JSON utf8][raw typed-array bytes...]. */
export function serialize(world: World): Uint8Array {
  const stores: Header['stores'] = {};
  for (const n of STORE_NAMES) {
    const s = world[n] as EntityStore<Schema>;
    stores[n] = { capacity: s.capacity, count: s.count, freeTop: s.freeCount };
  }
  const header: Header = {
    version: SAVE_VERSION,
    seed: world.seed,
    width: world.map.width,
    height: world.map.height,
    tick: world.tick,
    rng: Array.from(world.rng.state),
    stores,
    economy: saveLedger(world.economy),
    weather: { ...world.weather },
    research: saveResearch(world.research),
    scenario: { ...world.scenario },
    park: { ...world.park },
    patrolAreas: Array.from(world.patrolAreas),
    umbrellas: Array.from(world.umbrellas),
    grounds: Array.from(world.grounds),
    staffNames: Object.fromEntries(world.staffNames),
    track: {
      pieces: {
        capacity: world.track.pieces.capacity,
        count: world.track.pieces.count,
        freeTop: world.track.pieces.freeCount,
      },
      lastResult: world.track.lastResult,
      lastPiece: world.track.lastPiece,
    },
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const vs = views(world);
  const total = 8 + headerBytes.length + vs.reduce((n, v) => n + v.byteLength, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, headerBytes.length, true);
  out.set(headerBytes, 8);
  let off = 8 + headerBytes.length;
  for (const v of vs) {
    out.set(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), off);
    off += v.byteLength;
  }
  return out;
}

/** Guest columns appended after a save's version: approach gap, navigation, stats, then ride history. */
function guestColumnsAbsent(version: number): number {
  return (
    (version <= PRE_GUEST_STATS_SAVE_VERSION ? 3 : 0) +
    (version <= PRE_APPROACH_SAVE_VERSION ? 1 : 0) +
    (version <= PRE_NAVIGATION_SAVE_VERSION ? 5 : 0) +
    (version <= PRE_RIDE_HISTORY_SAVE_VERSION ? 5 : 0)
  );
}

/** The worker-order bit field was appended to staff storage in version 13. */
function staffColumnsAbsent(version: number): number {
  return version <= PRE_STAFF_ORDER_SAVE_VERSION ? 1 : 0;
}

/** Ride columns appended after a save's version: income, the train layout, then reliability. */
function rideColumnsAbsent(version: number): number {
  let absent = 0;
  if (version <= PRE_INCOME_SAVE_VERSION) absent += 1;
  if (version <= PRE_TRAIN_LAYOUT_SAVE_VERSION) absent += 2;
  if (version <= PRE_RELIABILITY_SAVE_VERSION) absent += RIDE_COLUMNS_ADDED_IN_V10;
  if (version < SAVE_VERSION) absent += RIDER_HISTORY_WINDOWS;
  return absent;
}

export function deserialize(bytes: Uint8Array): World {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('Not an OpenCoaster save');
  const headerLen = dv.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLen))) as Header;
  const supported = [
    PRE_RIDES_SAVE_VERSION,
    PRE_HEADING_SAVE_VERSION,
    PRE_STAFF_CARE_SAVE_VERSION,
    6,
    PRE_INCOME_SAVE_VERSION,
    PRE_TRAIN_LAYOUT_SAVE_VERSION,
    PRE_APPROACH_SAVE_VERSION,
    PRE_NAVIGATION_SAVE_VERSION,
    PRE_RELIABILITY_SAVE_VERSION,
    PRE_GUEST_STATS_SAVE_VERSION,
    PRE_RIDE_HISTORY_SAVE_VERSION,
    PREVIOUS_SAVE_VERSION,
    SAVE_VERSION,
  ];
  if (!supported.includes(header.version)) {
    throw new Error(`Unsupported save version ${header.version}`);
  }
  checkHeaderBounds(header);
  const world = new World({
    seed: header.seed,
    width: header.width,
    height: header.height,
    maxGuests: header.stores.guests.capacity,
  });
  world.tick = header.tick;
  if (header.patrolAreas) world.patrolAreas.set(header.patrolAreas);
  if (header.umbrellas) world.umbrellas.set(header.umbrellas);
  if (header.grounds) world.grounds.set(header.grounds);
  for (const [id, name] of Object.entries(header.staffNames ?? {}))
    world.staffNames.set(Number(id), name);
  world.rng.state.set(header.rng);
  let off = 8 + headerLen;
  const allViews = views(world);
  const legacyViews = header.version === PRE_RIDES_SAVE_VERSION ? legacyRideViews(world) : [];
  const legacyGuests =
    header.version <= PRE_HEADING_SAVE_VERSION
      ? new EntityStore(LEGACY_GUEST_SCHEMA, world.guests.capacity)
      : null;
  const trackViews = [...world.track.pieces.arrays(), ...world.track.rideTables()];
  const rideViewEnd = allViews.length - trackViews.length;
  const rideViewStart = rideViewEnd - world.rides.arrays().length;
  const guestViewStart = world.map.arrays().length;
  const guestPayloadViews = legacyGuests
    ? legacyGuests.arrays()
    : allViews.slice(
        guestViewStart,
        guestViewStart + world.guests.arrays().length - guestColumnsAbsent(header.version),
      );
  const staffViewStart = guestViewStart + world.guests.arrays().length;
  const staffViewEnd = staffViewStart + world.staff.arrays().length;
  const serializedViews = [
    ...allViews.slice(0, guestViewStart),
    ...guestPayloadViews,
    ...allViews.slice(staffViewStart, staffViewEnd - staffColumnsAbsent(header.version)),
    ...allViews.slice(staffViewEnd, rideViewStart),
    ...(header.version === PRE_RIDES_SAVE_VERSION
      ? legacyViews
      : allViews.slice(rideViewStart, rideViewEnd - rideColumnsAbsent(header.version))),
    ...allViews.slice(rideViewEnd),
  ];
  for (const v of serializedViews) {
    new Uint8Array(v.buffer, v.byteOffset, v.byteLength).set(
      bytes.subarray(off, off + v.byteLength),
    );
    off += v.byteLength;
  }
  for (const n of STORE_NAMES) {
    const h = header.stores[n];
    (world[n] as EntityStore<Schema>).restore(h.count, h.freeTop);
  }
  if (header.version <= PRE_STAFF_ORDER_SAVE_VERSION) {
    for (let slot = 0; slot < world.staff.count; slot++) {
      world.staff.cols.orderFlags[slot] = defaultStaffOrderFlags(world.staff.cols.kind[slot]);
    }
  }
  world.track.pieces.restore(header.track.pieces.count, header.track.pieces.freeTop);
  world.track.lastResult = header.track.lastResult;
  world.track.lastPiece = header.track.lastPiece;
  restoreLedger(world.economy, header.economy);
  if (header.version === PRE_RIDES_SAVE_VERSION) migrateLegacyRides(world, legacyViews);
  if (legacyGuests) migrateLegacyGuests(world, legacyGuests, header.stores.guests.count);
  if (header.version <= PRE_RELIABILITY_SAVE_VERSION) migratePreReliabilityRides(world);
  if (header.version <= PRE_GUEST_STATS_SAVE_VERSION)
    migrateGuestHistory(world, header.stores.guests.count);
  if (header.version <= PRE_APPROACH_SAVE_VERSION)
    migrateMissingApproachGap(world, header.stores.guests.count);
  Object.assign(world.weather, header.weather);
  const research =
    header.version < RESEARCH_UNITS_SAVE_VERSION
      ? upgradeLegacyResearchSave(header.research as unknown as LegacyResearchSave)
      : header.research;
  restoreResearch(world.research, research);
  Object.assign(world.scenario, header.scenario);
  if (header.park) Object.assign(world.park, header.park);
  if (header.version < SAVE_VERSION) {
    world.economy.inputs.wageBillPerWeek = calculateStaffWageBill(world);
  }
  return world;
}

export interface SaveSummary {
  version: number;
  tick: number;
  cash: number;
  loan: number;
}

/** Reads the header only, for save listings. Throws for bytes that are not an OpenCoaster save. */
export function summarizeSave(bytes: Uint8Array): SaveSummary {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 8 || dv.getUint32(0, true) !== MAGIC) {
    throw new Error('Not an OpenCoaster save');
  }
  const headerLen = dv.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLen))) as Header;
  return {
    version: header.version,
    tick: header.tick,
    cash: header.economy.cash,
    loan: header.economy.loan,
  };
}
