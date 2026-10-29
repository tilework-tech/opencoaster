import { flattenWaterBodies } from '../sim/map/area-tools';
import { World } from '../sim/core/world';
import { EntityStore } from '../sim/core/entity-store';
import type { Schema } from '../sim/core/entity-store';
import {
  GUEST_SCHEMA,
  GUEST_SIGHT_COLUMNS,
  GuestState,
  HEADING_NONE,
} from '../sim/guests/guest-store';
import type { ParkState } from '../sim/guests/park';
import { restoreLedger, saveLedger } from '../sim/economy/ledger';
import type { LedgerSave } from '../sim/economy/ledger';
import { restoreResearch, saveResearch, upgradeLegacyResearchSave } from '../sim/research/research';
import type { LegacyResearchSave, ResearchSave } from '../sim/research/research';
import type { ScenarioState } from '../sim/scenario/scenario';
import {
  calculateStaffWageBill,
  defaultStaffOrderFlags,
  MOW_TILE_DELAY,
  StaffKind,
  StaffOrder,
  STAFF_SCHEMA,
  STAFF_STAT_COLUMNS,
} from '../sim/staff/staff-store';
import { LITTER_SCHEMA } from '../sim/guests/litter-store';
import {
  RIDE_COLUMNS_ADDED_IN_V10,
  RIDE_COLUMNS_ADDED_IN_V30,
  RIDER_HISTORY_WINDOWS,
  RidePhase,
  RideState,
} from '../sim/rides/ride-store';
import { RideMode } from '../sim/rides/ride-modes';
import { PieceMode } from '../sim/track/track-types';
import { RIDE_CATALOG, RideType } from '../sim/rides/ride-types';
import { RELIABILITY_MAX } from '../sim/rides/ride-maintenance';
import { closeInvalidOpenRides } from '../sim/rides/ride-commands';
import { migrateQueueLinks } from '../sim/map/queue-link-migration';
import { migrateTrackHeights } from '../sim/track/track-height-migration';
import { migrateSingleTileRides } from '../sim/rides/ride-footprint-migration';
import { migrateBoardingFronts } from '../sim/rides/boarding-front';
import { ElementType } from '../sim/map/tile-map';
import { isWallScenery, type SceneryItem } from '../sim/map/scenery';
import { repairSavedRideTrains } from '../sim/vehicles/ride-trains';
import { migrateLegacyAmbientTrees } from '../sim/map/ambient-trees';
import { purgeExteriorMess } from '../sim/guests/park-interior';

/** Staff activity totals and guest sight memory are stored from this version. */
const STAFF_STATS_SAVE_VERSION = 32;
const PRE_STAFF_STATS_SAVE_VERSION = 31;
/** v33: park header gains `spawns`, the map-edge points where guests arrive; older saves keep spawning at the gate. */
const SANDBOX_SPAWN_SAVE_VERSION = 33;
/** v34: legacy ambient trees become ordinary saved scenery. */
const AMBIENT_TREES_SAVE_VERSION = 34;
export const SAVE_VERSION = AMBIENT_TREES_SAVE_VERSION;
/** Ride entrances and exits carry a stored front edge from this version. */
const BOARDING_FRONT_SAVE_VERSION = 28;
/** Rides with block brakes run block-sectioned from this version; before it brakes alone separated trains. */
const BLOCK_MODE_SAVE_VERSION = 27;
/** Rides carry a rolling downtime window and mechanic heading tick from this version. */
const DOWNTIME_SAVE_VERSION = 30;
/** Track heights count half-level track steps from this version; earlier saves store whole levels. */
const TRACK_STEP_SAVE_VERSION = 26;
const HAPPINESS_TARGET_SAVE_VERSION = 29;
const PRE_TRACK_STEP_SAVE_VERSION = 25;
const WALL_EDGE_SAVE_VERSION = 24;
const PRE_WALL_EDGE_SAVE_VERSION = 23;
/** Queue pieces carry explicit links to the neighbours that follow them from this version. */
const QUEUE_LINKS_SAVE_VERSION = 25;
const PRE_QUEUE_LINKS_SAVE_VERSION = 24;
/** Flat rides gained multi-tile footprints and a stored orientation in version 22. */
const FOOTPRINT_SAVE_VERSION = 22;
/** Last version before guests and rides carried queue-order counters and queue limits. */
const PRE_QUEUE_ORDER_SAVE_VERSION = 22;
const PRE_PATH_STYLE_SAVE_VERSION = 16;
const PATH_STYLE_SAVE_VERSION = 17;
/** Guests carry campaign vouchers from this version; earlier guests carry none. */
const VOUCHER_SAVE_VERSION = 18;
const PRE_TRACKED_WATER_RIDES_SAVE_VERSION = 19;
const PER_STAFF_PATROL_SAVE_VERSION = 20;
/** Water is one flat sheet per connected body from this version. */
const FLAT_WATER_SAVE_VERSION = 21;
const PREVIOUS_SAVE_VERSION = 15;
const PRE_V15_SAVE_VERSION = 14;
const PRE_GUEST_STATS_SAVE_VERSION = 11;
const PRE_RIDE_HISTORY_SAVE_VERSION = 12;
const STAFF_ORDER_SAVE_VERSION = 13;
const GUEST_MEMORY_SAVE_VERSION = 15;
const STAFF_SWEEP_SAVE_VERSION = 15;
const LITTER_ORDER_SAVE_VERSION = 15;
const RIDER_HISTORY_SAVE_VERSION = 14;
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
        ...GUEST_SIGHT_COLUMNS,
      ].includes(name),
  ),
) as Omit<
  typeof GUEST_SCHEMA,
  | 'heading'
  | (typeof GUEST_SIGHT_COLUMNS)[number]
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
  | 'litterMemory'
  | 'angriness'
>;
type StatColumn = (typeof STAFF_STAT_COLUMNS)[number];
const isStatColumn = (name: string): boolean =>
  (STAFF_STAT_COLUMNS as readonly string[]).includes(name);
const PRE_ORDER_STAFF_SCHEMA = Object.fromEntries(
  Object.entries(STAFF_SCHEMA).filter(
    ([name]) =>
      name !== 'orderFlags' &&
      name !== 'sweeps' &&
      name !== 'vandalsStopped' &&
      !isStatColumn(name),
  ),
) as Omit<typeof STAFF_SCHEMA, 'orderFlags' | 'sweeps' | 'vandalsStopped' | StatColumn>;
const PRE_SWEEP_STAFF_SCHEMA = Object.fromEntries(
  Object.entries(STAFF_SCHEMA).filter(
    ([name]) => name !== 'sweeps' && name !== 'vandalsStopped' && !isStatColumn(name),
  ),
) as Omit<typeof STAFF_SCHEMA, 'sweeps' | 'vandalsStopped' | StatColumn>;
const PRE_VANDAL_STOP_STAFF_SCHEMA = Object.fromEntries(
  Object.entries(STAFF_SCHEMA).filter(([name]) => name !== 'vandalsStopped' && !isStatColumn(name)),
) as Omit<typeof STAFF_SCHEMA, 'vandalsStopped' | StatColumn>;
const LEGACY_LITTER_SCHEMA = Object.fromEntries(
  Object.entries(LITTER_SCHEMA).filter(([name]) => name !== 'birthOrder'),
) as Omit<typeof LITTER_SCHEMA, 'birthOrder'>;
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
  weather: { kind: number; temperature: number; ticksUntilChange: number; climate?: number };
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

function migrateFlatWaterRides(world: World): void {
  const rides = world.rides.cols;
  const waterRideIds = new Set<number>();
  for (let slot = 0; slot < world.rides.count; slot++) {
    if (rides.typeId[slot] !== RideType.LogFlume && rides.typeId[slot] !== RideType.RiverRapids)
      continue;
    waterRideIds.add(world.rides.slotToId[slot]);
    rides.state[slot] = RideState.Closed;
    rides.phase[slot] = RidePhase.Closed;
    rides.entrancePlaced[slot] = 0;
    rides.exitPlaced[slot] = 0;
    rides.queueConnected[slot] = 0;
    rides.queueLength[slot] = 0;
    rides.boarded[slot] = 0;
    rides.tested[slot] = 0;
    rides.excitement[slot] = 0;
    rides.intensity[slot] = 0;
    rides.nausea[slot] = 0;
    rides.testMaxSpeed[slot] = 0;
    rides.testMaxPositiveG[slot] = 0;
    rides.testMaxNegativeG[slot] = 0;
    rides.testMaxLateralG[slot] = 0;
    rides.testDropCount[slot] = 0;
    rides.testHighestDrop[slot] = 0;
    rides.testInversionCount[slot] = 0;
    rides.testDurationTicks[slot] = 0;
  }
  const guests = world.guests.cols;
  for (let slot = 0; slot < world.guests.count; slot++) {
    if (!waterRideIds.has(guests.targetRide[slot])) continue;
    guests.targetRide[slot] = -1;
    guests.state[slot] = GuestState.Wandering;
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
  guests.litterMemory.fill(0, 0, count);
  guests.angriness.fill(0, 0, count);
}

function copyStoreIndexArrays(target: EntityStore<Schema>, source: EntityStore<Schema>): void {
  const [slotToId, idToSlot, freeIds] = target.arrays() as Uint32Array[];
  const [sourceSlotToId, sourceIdToSlot, sourceFreeIds] = source.arrays() as Uint32Array[];
  slotToId.set(sourceSlotToId);
  idToSlot.set(sourceIdToSlot);
  freeIds.set(sourceFreeIds);
}

function migratePreOrderStaff(
  world: World,
  legacy: EntityStore<typeof PRE_ORDER_STAFF_SCHEMA>,
): void {
  copyStoreIndexArrays(world.staff, legacy as EntityStore<Schema>);
  for (const key of Object.keys(
    PRE_ORDER_STAFF_SCHEMA,
  ) as (keyof typeof PRE_ORDER_STAFF_SCHEMA)[]) {
    world.staff.cols[key].set(legacy.cols[key]);
  }
  for (let slot = 0; slot < legacy.count; slot++)
    world.staff.cols.orderFlags[slot] = defaultStaffOrderFlags(world.staff.cols.kind[slot]);
  world.staff.cols.sweeps.fill(0);
  world.staff.cols.vandalsStopped.fill(0);
}

function migrateVersion13Staff(
  world: World,
  legacy: EntityStore<typeof PRE_SWEEP_STAFF_SCHEMA>,
): void {
  copyStoreIndexArrays(world.staff, legacy as EntityStore<Schema>);
  for (const key of Object.keys(
    PRE_SWEEP_STAFF_SCHEMA,
  ) as (keyof typeof PRE_SWEEP_STAFF_SCHEMA)[]) {
    world.staff.cols[key].set(legacy.cols[key]);
  }
  world.staff.cols.sweeps.fill(0);
  world.staff.cols.vandalsStopped.fill(0);
}

function migrateVersion15Staff(
  world: World,
  legacy: EntityStore<typeof PRE_VANDAL_STOP_STAFF_SCHEMA>,
): void {
  copyStoreIndexArrays(world.staff, legacy as EntityStore<Schema>);
  for (const key of Object.keys(
    PRE_VANDAL_STOP_STAFF_SCHEMA,
  ) as (keyof typeof PRE_VANDAL_STOP_STAFF_SCHEMA)[]) {
    world.staff.cols[key].set(legacy.cols[key]);
  }
  world.staff.cols.vandalsStopped.fill(0);
}

/** Handymen who tended gardens before mowing was its own order keep mowing; hire dates start at park open. */
function migrateStaffStats(world: World): void {
  const staff = world.staff.cols;
  for (let slot = 0; slot < world.staff.count; slot++) {
    if (
      staff.kind[slot] === StaffKind.Handyman &&
      (staff.orderFlags[slot] & (1 << StaffOrder.WaterGardens)) !== 0
    )
      staff.orderFlags[slot] |= 1 << StaffOrder.MowGrass;
    staff.mowTimeout[slot] = MOW_TILE_DELAY;
  }
}

function migrateLegacyLitter(world: World, legacy: EntityStore<typeof LEGACY_LITTER_SCHEMA>): void {
  copyStoreIndexArrays(world.litter, legacy as EntityStore<Schema>);
  for (const key of Object.keys(LEGACY_LITTER_SCHEMA) as (keyof typeof LEGACY_LITTER_SCHEMA)[]) {
    world.litter.cols[key].set(legacy.cols[key]);
  }
  const oldestFirst = Array.from({ length: legacy.count }, (_, slot) => slot);
  oldestFirst.sort(
    (a, b) => legacy.cols.age[b] - legacy.cols.age[a] || legacy.slotToId[a] - legacy.slotToId[b],
  );
  oldestFirst.forEach((slot, order) => (world.litter.cols.birthOrder[slot] = order + 1));
}

function migrateMissingApproachGap(world: World, count: number): void {
  world.guests.cols.approachGap.fill(0xffff, 0, count);
}

function migrateVoucherlessGuests(world: World, count: number): void {
  world.guests.cols.voucherKind.fill(0, 0, count);
  world.guests.cols.voucherTarget.fill(-1, 0, count);
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

/** Guest columns appended after a save's version: approach, navigation, stats, history, memory, then vouchers. */
function guestColumnsAbsent(version: number): number {
  return (
    (version <= PRE_GUEST_STATS_SAVE_VERSION ? 3 : 0) +
    (version <= PRE_APPROACH_SAVE_VERSION ? 1 : 0) +
    (version <= PRE_NAVIGATION_SAVE_VERSION ? 5 : 0) +
    (version <= PRE_RIDE_HISTORY_SAVE_VERSION ? 5 : 0) +
    (version < GUEST_MEMORY_SAVE_VERSION ? 2 : 0) +
    (version < VOUCHER_SAVE_VERSION ? 2 : 0) +
    (version <= PRE_QUEUE_ORDER_SAVE_VERSION ? 1 : 0) +
    (version < HAPPINESS_TARGET_SAVE_VERSION ? 1 : 0) +
    (version < STAFF_STATS_SAVE_VERSION ? GUEST_SIGHT_COLUMNS.length : 0)
  );
}

/** Ride columns appended after a save's version: income, the train layout, reliability, history, then orientation. */
function rideColumnsAbsent(version: number): number {
  let absent = 0;
  if (version <= PRE_INCOME_SAVE_VERSION) absent += 1;
  if (version <= PRE_TRAIN_LAYOUT_SAVE_VERSION) absent += 2;
  if (version <= PRE_RELIABILITY_SAVE_VERSION) absent += RIDE_COLUMNS_ADDED_IN_V10;
  if (version < RIDER_HISTORY_SAVE_VERSION) absent += RIDER_HISTORY_WINDOWS;
  if (version < FOOTPRINT_SAVE_VERSION) absent += 1;
  if (version <= PRE_QUEUE_ORDER_SAVE_VERSION) absent += 2;
  if (version < DOWNTIME_SAVE_VERSION) absent += RIDE_COLUMNS_ADDED_IN_V30;
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
    STAFF_ORDER_SAVE_VERSION,
    PREVIOUS_SAVE_VERSION,
    PRE_V15_SAVE_VERSION,
    PRE_PATH_STYLE_SAVE_VERSION,
    PATH_STYLE_SAVE_VERSION,
    VOUCHER_SAVE_VERSION,
    PRE_TRACKED_WATER_RIDES_SAVE_VERSION,
    PER_STAFF_PATROL_SAVE_VERSION,
    FLAT_WATER_SAVE_VERSION,
    PRE_QUEUE_ORDER_SAVE_VERSION,
    PRE_WALL_EDGE_SAVE_VERSION,
    PRE_QUEUE_LINKS_SAVE_VERSION,
    PRE_TRACK_STEP_SAVE_VERSION,
    TRACK_STEP_SAVE_VERSION,
    BLOCK_MODE_SAVE_VERSION,
    BOARDING_FRONT_SAVE_VERSION,
    HAPPINESS_TARGET_SAVE_VERSION,
    DOWNTIME_SAVE_VERSION,
    STAFF_STATS_SAVE_VERSION,
    PRE_STAFF_STATS_SAVE_VERSION,
    SANDBOX_SPAWN_SAVE_VERSION,
    AMBIENT_TREES_SAVE_VERSION,
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
  if (header.patrolAreas && header.version >= PER_STAFF_PATROL_SAVE_VERSION)
    world.patrolAreas.set(header.patrolAreas);
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
  const legacyStaff =
    header.version < STAFF_ORDER_SAVE_VERSION
      ? new EntityStore(PRE_ORDER_STAFF_SCHEMA, world.staff.capacity)
      : null;
  const version13Staff =
    header.version >= STAFF_ORDER_SAVE_VERSION && header.version < STAFF_SWEEP_SAVE_VERSION
      ? new EntityStore(PRE_SWEEP_STAFF_SCHEMA, world.staff.capacity)
      : null;
  const version15Staff =
    header.version === PREVIOUS_SAVE_VERSION
      ? new EntityStore(PRE_VANDAL_STOP_STAFF_SCHEMA, world.staff.capacity)
      : null;
  const legacyLitter =
    header.version < LITTER_ORDER_SAVE_VERSION
      ? new EntityStore(LEGACY_LITTER_SCHEMA, world.litter.capacity)
      : null;
  const trackViews = [...world.track.pieces.arrays(), ...world.track.rideTables()];
  const rideViewEnd = allViews.length - trackViews.length;
  const rideViewStart = rideViewEnd - world.rides.arrays().length;
  const guestViewStart = world.map.arrays().length;
  const mapViews = allViews.slice(0, guestViewStart);
  const savedMapViews = header.version < PATH_STYLE_SAVE_VERSION ? mapViews.slice(0, -1) : mapViews;
  const guestPayloadViews = legacyGuests
    ? legacyGuests.arrays()
    : allViews.slice(
        guestViewStart,
        guestViewStart + world.guests.arrays().length - guestColumnsAbsent(header.version),
      );
  const guestViewEnd = guestViewStart + world.guests.arrays().length;
  const staffViewStart = guestViewEnd;
  const staffViewEnd = staffViewStart + world.staff.arrays().length;
  const vehicleViewEnd = staffViewEnd + world.vehicles.arrays().length;
  const litterViewEnd = vehicleViewEnd + world.litter.arrays().length;
  const serializedViews = [
    ...savedMapViews,
    ...guestPayloadViews,
    ...(legacyStaff
      ? legacyStaff.arrays()
      : version13Staff
        ? version13Staff.arrays()
        : version15Staff
          ? version15Staff.arrays()
          : allViews.slice(
              staffViewStart,
              staffViewEnd -
                (header.version < STAFF_STATS_SAVE_VERSION ? STAFF_STAT_COLUMNS.length : 0),
            )),
    ...allViews.slice(staffViewEnd, vehicleViewEnd),
    ...(legacyLitter ? legacyLitter.arrays() : allViews.slice(vehicleViewEnd, litterViewEnd)),
    ...allViews.slice(litterViewEnd, rideViewStart),
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
  if (legacyStaff) {
    legacyStaff.restore(header.stores.staff.count, header.stores.staff.freeTop);
    migratePreOrderStaff(world, legacyStaff);
  }
  if (version13Staff) {
    version13Staff.restore(header.stores.staff.count, header.stores.staff.freeTop);
    migrateVersion13Staff(world, version13Staff);
  }
  if (version15Staff) {
    version15Staff.restore(header.stores.staff.count, header.stores.staff.freeTop);
    migrateVersion15Staff(world, version15Staff);
  }
  if (header.patrolAreas && header.version < PER_STAFF_PATROL_SAVE_VERSION) {
    const mapSize = world.map.width * world.map.height;
    const blocksWide = Math.ceil(world.map.width / 4);
    for (let slot = 0; slot < world.staff.count; slot++) {
      const oldStart = world.staff.cols.kind[slot]! * mapSize;
      const area = slot + 1;
      let hasBlocks = false;
      for (let y = 0; y < world.map.height; y++)
        for (let x = 0; x < world.map.width; x++) {
          if (!header.patrolAreas[oldStart + y * world.map.width + x]) continue;
          const block = Math.floor(y / 4) * blocksWide + Math.floor(x / 4);
          world.patrolAreas[(area - 1) * world.patrolWordsPerArea + (block >>> 5)] |=
            1 << (block & 31);
          hasBlocks = true;
        }
      if (hasBlocks) world.staff.cols.patrolArea[slot] = area;
    }
  }
  if (legacyLitter) {
    legacyLitter.restore(header.stores.litter.count, header.stores.litter.freeTop);
    migrateLegacyLitter(world, legacyLitter);
  }
  world.track.pieces.restore(header.track.pieces.count, header.track.pieces.freeTop);
  world.track.lastResult = header.track.lastResult;
  world.track.lastPiece = header.track.lastPiece;
  let economySave = header.economy;
  if (header.version < PRE_PATH_STYLE_SAVE_VERSION) {
    economySave = header.economy;
  }
  restoreLedger(world.economy, economySave);
  if (header.version < PRE_PATH_STYLE_SAVE_VERSION) {
    world.economy.inputs.wageBillPerWeek = calculateStaffWageBill(world);
  }
  if (header.version === PRE_RIDES_SAVE_VERSION) migrateLegacyRides(world, legacyViews);
  if (legacyGuests) migrateLegacyGuests(world, legacyGuests, header.stores.guests.count);
  if (header.version < HAPPINESS_TARGET_SAVE_VERSION) {
    world.guests.cols.happinessTarget.set(
      world.guests.cols.happiness.subarray(0, world.guests.count),
    );
  }
  if (header.version <= PRE_RELIABILITY_SAVE_VERSION) migratePreReliabilityRides(world);
  if (header.version <= PRE_GUEST_STATS_SAVE_VERSION)
    migrateGuestHistory(world, header.stores.guests.count);
  if (header.version <= PRE_APPROACH_SAVE_VERSION)
    migrateMissingApproachGap(world, header.stores.guests.count);
  if (header.version < STAFF_STATS_SAVE_VERSION) migrateStaffStats(world);
  if (header.version < VOUCHER_SAVE_VERSION)
    migrateVoucherlessGuests(world, header.stores.guests.count);
  if (header.version < PRE_TRACKED_WATER_RIDES_SAVE_VERSION) migrateFlatWaterRides(world);
  if (header.version < FLAT_WATER_SAVE_VERSION) flattenWaterBodies(world.map);
  if (header.version < FOOTPRINT_SAVE_VERSION) migrateSingleTileRides(world);
  if (header.version < WALL_EDGE_SAVE_VERSION) migrateWallEdges(world);
  if (header.version < QUEUE_LINKS_SAVE_VERSION) migrateQueueLinks(world);
  if (header.version < TRACK_STEP_SAVE_VERSION) migrateTrackHeights(world);
  if (header.version < BLOCK_MODE_SAVE_VERSION) migrateBlockBrakeRides(world);
  if (header.version < BOARDING_FRONT_SAVE_VERSION) migrateBoardingFronts(world);
  Object.assign(world.weather, header.weather);
  const research =
    header.version < RESEARCH_UNITS_SAVE_VERSION
      ? upgradeLegacyResearchSave(header.research as unknown as LegacyResearchSave)
      : header.research;
  restoreResearch(world.research, research);
  Object.assign(world.scenario, header.scenario);
  if (header.park) Object.assign(world.park, header.park);
  if (header.version < AMBIENT_TREES_SAVE_VERSION) migrateLegacyAmbientTrees(world);
  purgeExteriorMess(world);
  closeInvalidOpenRides(world);
  repairSavedRideTrains(world);
  return world;
}

/** Rides with block brakes ran their trains by block section before the mode decided it. */
function migrateBlockBrakeRides(world: World): void {
  const pieces = world.track.pieces;
  const rides = world.rides.cols;
  for (let slot = 0; slot < pieces.count; slot++) {
    if (pieces.cols.mode[slot] !== PieceMode.BlockBrake) continue;
    const rideSlot = world.rides.idToSlot[pieces.cols.rideId[slot]];
    if (rideSlot < 0) continue;
    const modes = RIDE_CATALOG[rides.typeId[rideSlot] as RideType]?.modes ?? [];
    if (modes.some((entry) => entry.mode === RideMode.ContinuousCircuitBlockSectioned))
      rides.mode[rideSlot] = RideMode.ContinuousCircuitBlockSectioned;
  }
}

function migrateWallEdges(world: World): void {
  const map = world.map;
  for (let tile = 0; tile < map.width * map.height; tile++) {
    for (let element = map.firstElement(tile); element >= 0; element = map.nextElement(element)) {
      if (
        map.elType[element] === ElementType.SmallScenery &&
        isWallScenery(map.elData[element] as SceneryItem)
      )
        map.elFlags[element] = 0;
    }
  }
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
