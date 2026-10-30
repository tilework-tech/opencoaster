import { writeCarPoses } from './car-poses';
import { MAX_CARS } from '../sim/vehicles/ride-trains';
import type { World } from '../sim/core/world';
import type { EntityStore, Schema } from '../sim/core/entity-store';
import { rideBaseLevel } from '../sim/rides/ride-footprint';
import { INSPECTION_MINUTE_TICKS, RIDE_CATALOG, RideType } from '../sim/rides/ride-types';
import { nextEligibleInvention } from '../sim/research/research';
import {
  getRideMechanicStatus,
  getRideMinutesSinceInspection,
} from '../sim/rides/ride-maintenance';
import { RidePhase } from '../sim/rides/ride-store';
import { observationTowerCabinMilli } from '../sim/rides/observation-tower';
import type { CommandFeedback } from '../sim/core/feedback';
import { WeatherKind } from '../sim/weather/weather';
import { GuestState, Souvenir } from '../sim/guests/guest-store';
import { recountRideLines } from '../sim/guests/ride-lines';
import { isSeated } from '../sim/guests/resting';
import { circuitStatus, getConstructionCursor } from '../sim/track/construction';
import { MAX_TRACK_PIECES, MAX_TRACK_RIDES } from '../sim/track/track-store';
import { ScenarioStatus } from '../sim/scenario/scenario';
import {
  HISTORY_MONTHS,
  LedgerCategory,
  PriceMode,
  completedMonthTotal,
} from '../sim/economy/ledger';
import type { ActiveAward, ParkNewsItem } from '../sim/economy/ledger';
import type { ScenarioObjective } from '../sim/scenario/scenario';
import { objectiveMetric } from '../sim/scenario/scenario-system';
import { TILE_UNITS, TRACK_Z_STEP } from '../sim/core/constants';
import { demolitionRefund } from '../sim/rides/ride-refund';
import {
  estimatedWaitTicks,
  isShopCategory,
  rideQueueCapacity,
} from '../sim/rides/ride-operations';
import { stallSlotProblem } from '../sim/rides/stall-front';
import { worldOccupancies } from '../sim/map/occupancy';
import type { OccupancyVolume } from '../sim/map/occupancy';
import {
  blockSectionsForRide,
  maxCarsForRide,
  maxTrainsForRide,
} from '../sim/vehicles/ride-trains';

/** Ints per entity in a layer: fixed-point x, y, z, then layer-specific render metadata. */
export const SNAPSHOT_STRIDE = 4;
export const SNAPSHOT_RIDE_CAPACITY = 256;
export const SNAPSHOT_TRACK_CAPACITY = MAX_TRACK_PIECES;

/** Ints per ride in `Snapshot.rideInfo`; index with `RideInfo`. */
export const RIDE_INFO_STRIDE = 51;
/** One slot per ride type id, plus slot 0 which no type uses. */
export const RIDE_TYPE_SLOTS = Math.max(...Object.keys(RIDE_CATALOG).map(Number)) + 1;
export const GUEST_DETAIL_STRIDE = 20;

/** Bits of the carried-items word at the end of each guest detail row. */
export const enum CarriedItem {
  Balloon = 1,
  Hat = 2,
  TShirt = 4,
  Umbrella = 8,
  Map = 16,
}

const GUEST_HEADING_SHIFT = 16;
const GUEST_STATE_SHIFT = 24;

/** Last walking direction (0..3, or the sim's no-heading value) in a guest row's metadata word. */
export function guestRowHeading(word: number): number {
  return (word >>> GUEST_HEADING_SHIFT) & 0xff;
}

const GUEST_IDLE_BIT = 1 << 10;
const GUEST_SEATED_BIT = 1 << 14;

/** True once a guest sits on its bench seat (not while walking to or rising from it). */
export function guestRowSeated(word: number): boolean {
  return (word & GUEST_SEATED_BIT) !== 0;
}

const GUEST_DRAWN_SHIFT = 11;

/** Carried items drawn over a walking guest: bit 0 balloon, bit 1 hat, bit 2 umbrella (only while it rains). */
export function guestRowDrawnItems(word: number): number {
  return (word >>> GUEST_DRAWN_SHIFT) & 7;
}

/** True while a guest stands still (waiting at a ride or stall, or paused in a queue). */
export function guestRowIdle(word: number): boolean {
  return (word & GUEST_IDLE_BIT) !== 0;
}

/** The sim's `GuestState` in a guest row's metadata word. */
export function guestRowState(word: number): number {
  return word >>> GUEST_STATE_SHIFT;
}

/** Riders are drawn by the ride (seated in its vehicles) or hidden, never as walking sprites. */
export function isRidingGuestRow(word: number): boolean {
  return guestRowState(word) === GuestState.Riding;
}

export const enum RideInfo {
  Id = 0,
  Type = 1,
  State = 2,
  Phase = 3,
  Excitement = 4,
  Intensity = 5,
  Nausea = 6,
  QueueLength = 7,
  /** Bit mask of `RideFlag`. */
  Flags = 8,
  GuestsServed = 9,
  Price = 10,
  TrackPieces = 11,
  /** Tile, and height in track steps (TRACK_Z_STEP), where the next piece attaches (valid when the cursor has track). */
  CursorX = 12,
  CursorY = 13,
  CursorZ = 14,
  /** Packed by `encodeCursor`. */
  Cursor = 15,
  EntranceX = 16,
  EntranceY = 17,
  ExitX = 18,
  ExitY = 19,
  Reliability = 20,
  IncomeCents = 21,
  /** Anchor tile of the ride's footprint (the tile the footprint offsets are measured from). */
  RideX = 22,
  RideY = 23,
  DemolitionRefund = 24,
  /** Quarter turns the footprint is rotated by. */
  Dir = 25,
  /** Height level of the floor of a flat ride: the highest ground corner under its footprint. */
  BaseLevel = 26,
  /** Queue tiles behind the entrance (0 when the ride has no built queue line). */
  QueueTiles = 27,
  /** Estimated wait for a guest joining the line, in ticks. */
  WaitTicks = 28,
  /** Guests the whole line holds before it turns people away. */
  QueueCapacity = 29,
  /** The operator's queue length limit; 0 means none. */
  QueueLimit = 30,
  /** Permille of the current ride phase already elapsed, used to synchronize animated ride sprites. */
  PhaseProgress = 31,
  /** Trains the operator asked for; 0 means automatic. */
  TrainsSet = 32,
  /** Cars per train the operator asked for; 0 means the ride type's default. */
  CarsSet = 33,
  /** Most trains the block sections allow (track rides; 0 otherwise). */
  MaxTrains = 34,
  /** Most cars the station platform holds (track rides; 0 otherwise). */
  MaxCars = 35,
  /** Guests per dispatch with the current layout. */
  Capacity = 36,
  /** `RideMode` the ride is set to. */
  Mode = 37,
  /** Block sections of a closed circuit: its station plus each run of block brakes (track rides; 0 otherwise). */
  BlockSections = 38,
  /** Tower height in whole land levels (0 for rides other than the Observation Tower). */
  TowerHeight = 43,
  /** Cabin level in thousandths, including a stranded cabin or one returning after a breakdown. */
  TowerCabinLevel = 44,
  /** Rolling downtime, a whole percent. */
  Downtime = 39,
  /** The mechanic inspection interval in minutes; 0 means never. */
  InspectionMinutes = 40,
  /** Minutes since the last inspection, in the original game's inspection minutes. */
  MinutesSinceInspection = 41,
  /** `MechanicStatus` of the ride. */
  MechanicStatus = 42,
  /** `RideResult` explaining why guests cannot buy from a stall's front; `Ok` when they can or for other rides. */
  StallFront = 45,
  /** Price of a stall's second item, in cents. */
  Price2 = 46,
  /** Items sold and takings (cents) for the stall's first and second item. */
  ItemSold0 = 47,
  ItemSold1 = 48,
  ItemRevenue0 = 49,
  ItemRevenue1 = 50,
}

export const enum RideFlag {
  EntrancePlaced = 1 << 0,
  ExitPlaced = 1 << 1,
  QueueConnected = 1 << 2,
  Tested = 1 << 3,
  CircuitClosed = 1 << 4,
  /** The entrance sits on a queue tile, so guests line up on a built queue. */
  HasQueue = 1 << 5,
  /** The circuit is closed and includes a station: the minimum for testing the ride. */
  CircuitComplete = 1 << 6,
}

export interface DecodedCursor {
  hasTrack: boolean;
  dir: number;
  slope: number;
  bank: number;
}

export function encodeCursor(hasTrack: boolean, dir: number, slope: number, bank: number): number {
  return (hasTrack ? 1 << 7 : 0) | (bank << 5) | ((slope + 2) << 2) | dir;
}

export function decodeCursor(packed: number): DecodedCursor {
  return {
    hasTrack: (packed & (1 << 7)) !== 0,
    dir: packed & 3,
    slope: ((packed >> 2) & 7) - 2,
    bank: (packed >> 5) & 3,
  };
}

export interface SnapshotLayer {
  count: number;
  data: Int32Array;
}

/** Values published per worker in `Snapshot.staffStats`. */
export const STAFF_STAT_STRIDE = 9;

export interface Snapshot {
  tick: number;
  /** Increments for each published snapshot, including paused state changes. */
  revision: number;
  /** Successful construction commands produced since the previous simulation tick. */
  audioEvents: Array<{
    id: number;
    type: 'build' | 'demolish' | 'scream' | 'clank' | 'register';
    rideId?: number;
    intensity?: number;
  }>;
  guests: SnapshotLayer;
  staff: SnapshotLayer;
  /** Stable staff id per staff slot, in the same order as `staff`. */
  staffIds: Int32Array;
  /** Per-worker enabled task orders, using StaffOrder bit positions. */
  staffOrders: Uint8Array;
  /**
   * Activity totals per staff slot, `STAFF_STAT_STRIDE` values each: litter swept, lawns mown,
   * gardens watered, bins emptied, rides inspected, rides fixed, vandals stopped, guests
   * entertained, then the tick the worker was hired.
   */
  staffStats: Int32Array;
  /** Player-given staff names by staff id. */
  staffNames: ReadonlyMap<number, string>;
  vehicles: SnapshotLayer;
  /** One row per car of every train: x, y, z and a packed pose (see car-poses.ts). */
  cars: SnapshotLayer;
  litter: SnapshotLayer;
  rides: SnapshotLayer;
  tracks: SnapshotLayer;
  /** Derived occupied intervals for track preview. */
  occupancies: OccupancyVolume[];
  /** `RIDE_INFO_STRIDE` ints per ride, in the same order as `rides`. */
  rideInfo: Int32Array;
  /** Guest needs and thought history, aligned with the guest render layer. */
  guestDetails: Int32Array;
  /** Stable guest id per guest render row. */
  guestIds: Int32Array;
  weather: { kind: number; temperature: number };
  /** Outcome of the latest player command. */
  feedback: CommandFeedback;
  buildable: Uint8Array;
  /** Per-tile grass overgrowth and flower-bed bits (see staff/grounds.ts). */
  grounds: Uint8Array;
  /** Packed 4×4-tile masks indexed by allocated patrol area id. */
  patrolAreas: Uint32Array;
  patrolWordsPerArea: number;
  patrolAreaIds: Uint16Array;
  park: {
    cash: number;
    loan: number;
    rides: number;
    entranceX: number;
    entranceY: number;
    /** Queue tiles that no ride entrance owns. */
    orphanQueueTiles: number;
  };
  scenario: SnapshotScenario;
  economy: SnapshotEconomy;
  research: SnapshotResearch;
  activeAwards: ActiveAward[];
  parkNews: ParkNewsItem[];
}

/** Pricing and ledger figures for the finance window. Arrays are indexed by `LedgerCategory`, in cents. */
export interface SnapshotEconomy {
  priceMode: PriceMode;
  admissionPrice: number;
  maxLoan: number;
  parkValue: number;
  annualInterestBps: number;
  campaignId: number;
  campaignWeeksLeft: number;
  wageBillPerWeek: number;
  thisMonth: number[];
  lastMonth: number[];
  /** Retained completed months, newest first, each indexed by `LedgerCategory`. */
  pastMonths: number[][];
  /** Ride and stall running costs billed every fortnight, cents. */
  rideUpkeepPerFortnight: number;
  monthsCompleted: number;
  /** Guests the park rating counts as lost: lost, stranded, or off the footpaths. */
  lostGuests: number;
}

export interface SnapshotResearch {
  funding: number;
  enabledCategoryMask: number;
  /** Work done on the current invention and the work it needs; cost is -1 when nothing is eligible. */
  progress: number;
  currentCost: number;
  /** Item id currently being researched or next in the enabled scenario order, or -1. */
  currentItemId: number;
  /** Player-facing development phase, or an empty string when none is eligible. */
  progressStage: string;
  inventionCount: number;
  unlockedCount: number;
  /** 1 for each ride type the player may build, indexed by ride type id. */
  unlockedRides: Uint8Array;
}

export interface SnapshotScenario {
  status: ScenarioStatus;
  /** Null for sandbox games, which have no objective. */
  objective: ScenarioObjective | null;
  /** Live figure the objective compares with its target. */
  metric: number;
  parkRating: number;
}

export interface SnapshotCapacities {
  guests: number;
  staff: number;
  vehicles: number;
  cars?: number;
  litter: number;
  rides?: number;
  tracks?: number;
  mapTiles?: number;
  patrolAreas?: number;
  patrolWordsPerArea?: number;
}

export function createSnapshot(caps: SnapshotCapacities): Snapshot {
  const layer = (n: number): SnapshotLayer => ({
    count: 0,
    data: new Int32Array(n * SNAPSHOT_STRIDE),
  });
  return {
    tick: 0,
    revision: 0,
    audioEvents: [],
    guests: layer(caps.guests),
    staff: layer(caps.staff),
    staffIds: new Int32Array(caps.staff),
    staffOrders: new Uint8Array(caps.staff),
    staffStats: new Int32Array(caps.staff * STAFF_STAT_STRIDE),
    staffNames: new Map(),
    vehicles: layer(caps.vehicles),
    cars: layer(caps.cars ?? caps.vehicles * MAX_CARS),
    litter: layer(caps.litter),
    rides: layer(caps.rides ?? SNAPSHOT_RIDE_CAPACITY),
    tracks: layer(caps.tracks ?? SNAPSHOT_TRACK_CAPACITY),
    occupancies: [],
    rideInfo: new Int32Array((caps.rides ?? SNAPSHOT_RIDE_CAPACITY) * RIDE_INFO_STRIDE),
    guestDetails: new Int32Array(caps.guests * GUEST_DETAIL_STRIDE),
    guestIds: new Int32Array(caps.guests),
    weather: { kind: 0, temperature: 20 },
    feedback: { seq: 0, domain: 0, code: 0, subject: -1, detail: '' },
    buildable: new Uint8Array(caps.mapTiles ?? 0),
    grounds: new Uint8Array(caps.mapTiles ?? 0),
    patrolAreas: new Uint32Array(caps.patrolAreas ?? 0),
    patrolWordsPerArea: caps.patrolWordsPerArea ?? 0,
    patrolAreaIds: new Uint16Array(caps.staff),
    park: { cash: 0, loan: 0, rides: 0, entranceX: -1, entranceY: -1, orphanQueueTiles: 0 },
    scenario: { status: ScenarioStatus.Active, objective: null, metric: 0, parkRating: 0 },
    activeAwards: [],
    parkNews: [],
    economy: {
      priceMode: PriceMode.Free,
      admissionPrice: 0,
      maxLoan: 0,
      parkValue: 0,
      annualInterestBps: 0,
      campaignId: -1,
      campaignWeeksLeft: 0,
      wageBillPerWeek: 0,
      thisMonth: new Array<number>(LedgerCategory.COUNT).fill(0),
      lastMonth: new Array<number>(LedgerCategory.COUNT).fill(0),
      pastMonths: Array.from({ length: HISTORY_MONTHS }, () =>
        new Array<number>(LedgerCategory.COUNT).fill(0),
      ),
      rideUpkeepPerFortnight: 0,
      monthsCompleted: 0,
      lostGuests: 0,
    },
    research: {
      funding: 0,
      enabledCategoryMask: 0,
      progress: 0,
      currentCost: -1,
      currentItemId: -1,
      progressStage: '',
      inventionCount: 0,
      unlockedCount: 0,
      unlockedRides: new Uint8Array(RIDE_TYPE_SLOTS),
    },
  };
}

export function snapshotBuffers(s: Snapshot): ArrayBuffer[] {
  return [s.guests, s.staff, s.vehicles, s.cars, s.litter, s.rides, s.tracks]
    .map((l) => l.data.buffer as ArrayBuffer)
    .concat(
      s.rideInfo.buffer as ArrayBuffer,
      s.buildable.buffer as ArrayBuffer,
      s.grounds.buffer as ArrayBuffer,
      s.patrolAreas.buffer as ArrayBuffer,
      s.staffIds.buffer as ArrayBuffer,
      s.staffOrders.buffer as ArrayBuffer,
      s.staffStats.buffer as ArrayBuffer,
      s.patrolAreaIds.buffer as ArrayBuffer,
      s.guestDetails.buffer as ArrayBuffer,
      s.guestIds.buffer as ArrayBuffer,
    );
}

type PosCols = { x: Int32Array; y: Int32Array; z: Int32Array };

function writeLayer<S extends Schema>(
  layer: SnapshotLayer,
  store: EntityStore<S>,
  variant: Uint8Array,
  state: Uint8Array | null,
): void {
  const { x, y, z } = store.cols as unknown as PosCols;
  const n = Math.min(store.count, layer.data.length / SNAPSHOT_STRIDE);
  const d = layer.data;
  for (let i = 0, o = 0; i < n; i++, o += SNAPSHOT_STRIDE) {
    d[o] = x[i];
    d[o + 1] = y[i];
    d[o + 2] = z[i];
    d[o + 3] = ((state ? state[i] : 0) << 8) | variant[i];
  }
  layer.count = n;
}

function writePeopleLayer<S extends Schema>(
  layer: SnapshotLayer,
  store: EntityStore<S>,
  variant: Uint8Array,
  state: Uint8Array,
  direction: (slot: number) => number,
): void {
  const { x, y, z } = store.cols as unknown as PosCols;
  const n = Math.min(store.count, layer.data.length / SNAPSHOT_STRIDE);
  const d = layer.data;
  for (let i = 0, o = 0; i < n; i++, o += SNAPSHOT_STRIDE) {
    d[o] = x[i];
    d[o + 1] = y[i];
    d[o + 2] = z[i];
    d[o + 3] = (state[i] << 16) | ((direction(i) & 3) << 8) | variant[i];
  }
  layer.count = n;
}

/** Permille of the Running phase elapsed; 0 in every other phase. */
function phaseProgress(r: World['rides']['cols'], slot: number): number {
  if (r.phase[slot] !== RidePhase.Running || r.runTicks[slot] === 0) return 0;
  const elapsed = Math.max(0, r.runTicks[slot] - r.phaseTicks[slot]);
  return Math.min(1000, Math.round((elapsed * 1000) / r.runTicks[slot]));
}

function writeRideInfo(world: World, info: Int32Array, slot: number): void {
  const r = world.rides.cols;
  const o = slot * RIDE_INFO_STRIDE;
  const rideId = world.rides.slotToId[slot];
  info[o + RideInfo.Id] = rideId;
  info[o + RideInfo.Type] = r.typeId[slot];
  info[o + RideInfo.State] = r.state[slot];
  info[o + RideInfo.Phase] = r.phase[slot];
  info[o + RideInfo.Excitement] = r.excitement[slot];
  info[o + RideInfo.Intensity] = r.intensity[slot];
  info[o + RideInfo.Nausea] = r.nausea[slot];
  info[o + RideInfo.QueueLength] = world.rideLines.queued[slot];
  const trackRide = rideId < MAX_TRACK_RIDES;
  info[o + RideInfo.Flags] =
    (r.entrancePlaced[slot] ? RideFlag.EntrancePlaced : 0) |
    (r.exitPlaced[slot] ? RideFlag.ExitPlaced : 0) |
    (r.queueConnected[slot] ? RideFlag.QueueConnected : 0) |
    (r.tested[slot] ? RideFlag.Tested : 0) |
    (world.queues.hasQueue[slot] ? RideFlag.HasQueue : 0) |
    (trackRide && world.track.closed[rideId] ? RideFlag.CircuitClosed : 0) |
    (trackRide && circuitStatus(world, rideId).complete ? RideFlag.CircuitComplete : 0);
  info[o + RideInfo.GuestsServed] = r.guestsServed[slot];
  info[o + RideInfo.Price] = r.price[slot];
  info[o + RideInfo.Price2] = r.price2[slot];
  info[o + RideInfo.ItemSold0] = r.itemSold0[slot];
  info[o + RideInfo.ItemSold1] = r.itemSold1[slot];
  info[o + RideInfo.ItemRevenue0] = r.itemRevenue0[slot];
  info[o + RideInfo.ItemRevenue1] = r.itemRevenue1[slot];
  info[o + RideInfo.TrackPieces] = trackRide ? world.track.count[rideId] : 0;
  info[o + RideInfo.EntranceX] = r.entranceX[slot];
  info[o + RideInfo.EntranceY] = r.entranceY[slot];
  info[o + RideInfo.ExitX] = r.exitX[slot];
  info[o + RideInfo.ExitY] = r.exitY[slot];
  info[o + RideInfo.Reliability] = r.reliability[slot];
  info[o + RideInfo.Downtime] = r.downtimePercent[slot];
  info[o + RideInfo.InspectionMinutes] = Math.round(
    r.inspectionIntervalTicks[slot] / INSPECTION_MINUTE_TICKS,
  );
  info[o + RideInfo.MinutesSinceInspection] = getRideMinutesSinceInspection(world, rideId);
  info[o + RideInfo.MechanicStatus] = getRideMechanicStatus(world, rideId);
  info[o + RideInfo.IncomeCents] = r.incomeCents[slot];
  info[o + RideInfo.RideX] = r.rideX[slot];
  info[o + RideInfo.RideY] = r.rideY[slot];
  info[o + RideInfo.DemolitionRefund] = demolitionRefund(world, rideId);
  info[o + RideInfo.Dir] = r.dir[slot];
  const definition = RIDE_CATALOG[r.typeId[slot] as RideType];
  info[o + RideInfo.BaseLevel] = definition
    ? rideBaseLevel(world.map, definition, r.rideX[slot], r.rideY[slot], r.dir[slot])
    : 0;
  info[o + RideInfo.QueueTiles] = world.queues.tiles[slot];
  info[o + RideInfo.WaitTicks] = estimatedWaitTicks(world, slot);
  info[o + RideInfo.QueueCapacity] = rideQueueCapacity(world, slot);
  info[o + RideInfo.QueueLimit] = r.queueLimit[slot];
  info[o + RideInfo.PhaseProgress] = phaseProgress(r, slot);
  info[o + RideInfo.TrainsSet] = r.trainCount[slot];
  info[o + RideInfo.CarsSet] = r.carsPerTrain[slot];
  info[o + RideInfo.Capacity] = r.capacity[slot];
  info[o + RideInfo.MaxTrains] = definition?.usesTrack ? maxTrainsForRide(world, rideId) : 0;
  info[o + RideInfo.MaxCars] = definition?.usesTrack ? maxCarsForRide(world, rideId) : 0;
  info[o + RideInfo.Mode] = r.mode[slot];
  info[o + RideInfo.BlockSections] = definition?.usesTrack
    ? blockSectionsForRide(world, rideId)
    : 0;
  info[o + RideInfo.StallFront] =
    definition && isShopCategory(definition.category) ? stallSlotProblem(world, slot) : 0;
  info[o + RideInfo.TowerHeight] = r.towerHeight[slot];
  info[o + RideInfo.TowerCabinLevel] =
    r.typeId[slot] === RideType.ObservationTower
      ? observationTowerCabinMilli(
          r.towerHeight[slot],
          r.phase[slot],
          r.phaseTicks[slot],
          r.runTicks[slot],
          r.unloadTicks[slot],
        )
      : 0;
  if (!definition?.usesTrack) {
    info[o + RideInfo.CursorX] = 0;
    info[o + RideInfo.CursorY] = 0;
    info[o + RideInfo.CursorZ] = 0;
    info[o + RideInfo.Cursor] = encodeCursor(false, 0, 0, 0);
    return;
  }
  const cursor = getConstructionCursor(world, rideId);
  info[o + RideInfo.CursorX] = cursor.x;
  info[o + RideInfo.CursorY] = cursor.y;
  info[o + RideInfo.CursorZ] = cursor.z;
  info[o + RideInfo.Cursor] = encodeCursor(cursor.hasTrack, cursor.dir, cursor.slope, cursor.bank);
}

function carriedItems(world: World, slot: number): number {
  const g = world.guests.cols;
  return (
    ((g.souvenirs[slot] & Souvenir.Balloon) !== 0 ? CarriedItem.Balloon : 0) |
    ((g.souvenirs[slot] & Souvenir.Hat) !== 0 ? CarriedItem.Hat : 0) |
    ((g.souvenirs[slot] & Souvenir.TShirt) !== 0 ? CarriedItem.TShirt : 0) |
    (world.umbrellas[world.guests.slotToId[slot]] === 1 ? CarriedItem.Umbrella : 0) |
    (g.hasMap[slot] === 1 ? CarriedItem.Map : 0)
  );
}

function drawnItems(world: World, slot: number): number {
  const carried = carriedItems(world, slot);
  const raining = world.weather.kind >= WeatherKind.Rain;
  return (
    ((carried & CarriedItem.Balloon) !== 0 ? 1 : 0) |
    ((carried & CarriedItem.Hat) !== 0 ? 2 : 0) |
    (raining && (carried & CarriedItem.Umbrella) !== 0 ? 4 : 0)
  );
}

export function writeSnapshot(world: World, out: Snapshot): void {
  out.tick = world.tick;
  out.occupancies = worldOccupancies(world);
  out.audioEvents = world.audioEvents.map((event) => ({ ...event }));
  world.audioEvents.length = 0;
  out.activeAwards = world.economy.activeAwards
    .filter((award) => award.expiresTick > world.tick)
    .map((award) => ({ ...award }));
  out.parkNews = world.economy.parkNews.map((item) => ({ ...item }));
  recountRideLines(world);
  out.weather.kind = world.weather.kind;
  out.weather.temperature = world.weather.temperature;
  const buildableCount = Math.min(world.map.ownership.length, out.buildable.length);
  for (let i = 0; i < buildableCount; i++) out.buildable[i] = world.map.canBuild(i) ? 1 : 0;
  writePeopleLayer(
    out.guests,
    world.guests,
    world.guests.cols.tint,
    world.guests.cols.state,
    (slot) => Math.min(3, world.guests.cols.heading[slot]),
  );
  const guests = world.guests.cols;
  for (let i = 0; i < out.guests.count; i++) {
    const state = guests.state[i]!;
    const atCentre = (guests.x[i]! & 255) === 128 && (guests.y[i]! & 255) === 128;
    const idle =
      state === GuestState.Waiting ||
      state === GuestState.Shopping ||
      (state === GuestState.Queuing && atCentre);
    out.guests.data[i * SNAPSHOT_STRIDE + 3] =
      (state << GUEST_STATE_SHIFT) |
      (guests.heading[i]! << GUEST_HEADING_SHIFT) |
      (idle ? GUEST_IDLE_BIT : 0) |
      (state === GuestState.Sitting && isSeated(world, i) ? GUEST_SEATED_BIT : 0) |
      (drawnItems(world, i) << GUEST_DRAWN_SHIFT) |
      (out.guests.data[i * SNAPSHOT_STRIDE + 3]! & 0x3ff);
  }
  const guestCount = Math.min(world.guests.count, out.guestDetails.length / GUEST_DETAIL_STRIDE);
  for (let i = 0; i < guestCount; i++) {
    const o = i * GUEST_DETAIL_STRIDE;
    out.guestIds[i] = world.guests.slotToId[i];
    out.guestDetails[o] = guests.happiness[i];
    out.guestDetails[o + 1] = guests.hunger[i];
    out.guestDetails[o + 2] = guests.thirst[i];
    out.guestDetails[o + 3] = guests.toilet[i];
    out.guestDetails[o + 4] = guests.nausea[i];
    out.guestDetails[o + 5] = guests.energy[i];
    out.guestDetails[o + 6] = guests.cash[i];
    out.guestDetails[o + 7] = guests.thoughtCursor[i] & 3;
    out.guestDetails[o + 8] = guests.thought0[i];
    out.guestDetails[o + 9] = guests.thought1[i];
    out.guestDetails[o + 10] = guests.thought2[i];
    out.guestDetails[o + 11] = guests.thought3[i];
    out.guestDetails[o + 12] = guests.rideHistoryCursor[i] & 3;
    out.guestDetails[o + 13] = guests.rideHistory0[i];
    out.guestDetails[o + 14] = guests.rideHistory1[i];
    out.guestDetails[o + 15] = guests.rideHistory2[i];
    out.guestDetails[o + 16] = guests.rideHistory3[i];
    out.guestDetails[o + 17] = guests.voucherKind[i];
    out.guestDetails[o + 18] = guests.voucherTarget[i];
    out.guestDetails[o + 19] = carriedItems(world, i);
  }
  writePeopleLayer(
    out.staff,
    world.staff,
    world.staff.cols.kind,
    world.staff.cols.state,
    (slot) => {
      const staff = world.staff.cols;
      const dx = staff.targetX[slot] - Math.floor(staff.x[slot] / TILE_UNITS);
      const dy = staff.targetY[slot] - Math.floor(staff.y[slot] / TILE_UNITS);
      return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 2 : 0) : dy < 0 ? 3 : 1;
    },
  );
  const staffIdCount = Math.min(world.staff.count, out.staffIds.length);
  for (let i = 0; i < staffIdCount; i++) out.staffIds[i] = world.staff.slotToId[i];
  for (let i = 0; i < staffIdCount; i++) out.patrolAreaIds[i] = world.staff.cols.patrolArea[i]!;
  out.staffOrders.set(world.staff.cols.orderFlags.subarray(0, staffIdCount));
  const staffCols = world.staff.cols;
  for (let i = 0; i < staffIdCount; i++) {
    const o = i * STAFF_STAT_STRIDE;
    out.staffStats[o] = staffCols.sweeps[i];
    out.staffStats[o + 1] = staffCols.lawnsMown[i];
    out.staffStats[o + 2] = staffCols.gardensWatered[i];
    out.staffStats[o + 3] = staffCols.binsEmptied[i];
    out.staffStats[o + 4] = staffCols.ridesInspected[i];
    out.staffStats[o + 5] = staffCols.ridesFixed[i];
    out.staffStats[o + 6] = staffCols.vandalsStopped[i];
    out.staffStats[o + 7] = staffCols.guestsEntertained[i];
    out.staffStats[o + 8] = staffCols.hiredTick[i];
  }
  out.staffNames = world.staffNames;
  const groundCount = Math.min(world.grounds.length, out.grounds.length);
  out.grounds.set(world.grounds.subarray(0, groundCount));
  out.patrolWordsPerArea = world.patrolWordsPerArea;
  const patrolCount = Math.min(world.patrolAreas.length, out.patrolAreas.length);
  out.patrolAreas.set(world.patrolAreas.subarray(0, patrolCount));
  writeLayer(out.vehicles, world.vehicles, world.vehicles.cols.state, null);
  writeCarPoses(world, out.cars);
  writeLayer(out.litter, world.litter, world.litter.cols.kind, null);
  const rides = world.rides;
  const rideData = out.rides.data;
  const rideCount = Math.min(rides.count, rideData.length / SNAPSHOT_STRIDE);
  for (let i = 0, o = 0; i < rideCount; i++, o += SNAPSHOT_STRIDE) {
    const x = rides.cols.entranceX[i];
    const y = rides.cols.entranceY[i];
    const mapIndex = world.map.index(x, y);
    rideData[o] = x * 256 + 128;
    rideData[o + 1] = y * 256 + 128;
    rideData[o + 2] = world.map.inBounds(x, y) ? world.map.heights[mapIndex] * 64 : 0;
    rideData[o + 3] = rides.slotToId[i];
    writeRideInfo(world, out.rideInfo, i);
  }
  out.rides.count = rideCount;
  const trackPieces = world.track.pieces;
  const trackData = out.tracks.data;
  const trackCount = Math.min(trackPieces.count, trackData.length / SNAPSHOT_STRIDE);
  for (let i = 0, o = 0; i < trackCount; i++, o += SNAPSHOT_STRIDE) {
    trackData[o] = trackPieces.cols.x[i] * 256 + 128;
    trackData[o + 1] = trackPieces.cols.y[i] * 256 + 128;
    trackData[o + 2] = trackPieces.cols.z[i] * TRACK_Z_STEP;
    trackData[o + 3] =
      (trackPieces.cols.rideId[i] << 16) |
      (trackPieces.cols.mode[i] << 10) |
      (trackPieces.cols.dir[i] << 8) |
      (trackPieces.cols.pieceType[i] & 0xff);
  }
  out.tracks.count = trackCount;
  const feedback = world.feedback;
  out.feedback.seq = feedback.seq;
  out.feedback.domain = feedback.domain;
  out.feedback.code = feedback.code;
  out.feedback.subject = feedback.subject;
  out.feedback.detail = feedback.detail;
  out.park.cash = world.economy.cash;
  out.park.loan = world.economy.loan;
  out.park.rides = rides.count;
  out.park.entranceX = world.park.entranceX;
  out.park.entranceY = world.park.entranceY;
  out.park.orphanQueueTiles = world.queues.orphanTiles;
  const scenario = world.scenario;
  out.scenario.status = scenario.status;
  out.scenario.objective = scenario.objective ? { ...scenario.objective } : null;
  out.scenario.metric = scenario.objective ? objectiveMetric(world, scenario.objective) : 0;
  out.scenario.parkRating = world.economy.parkRating;
  const ledger = world.economy;
  const economy = out.economy;
  economy.priceMode = ledger.priceMode;
  economy.lostGuests = world.economy.inputs.lostGuests;
  economy.admissionPrice = ledger.admissionPrice;
  economy.maxLoan = ledger.maxLoan;
  economy.parkValue = ledger.parkValue;
  economy.annualInterestBps = ledger.annualInterestBps;
  economy.campaignId = ledger.campaignId;
  economy.campaignWeeksLeft = ledger.campaignWeeksLeft;
  economy.wageBillPerWeek = ledger.inputs.wageBillPerWeek;
  economy.monthsCompleted = ledger.monthsCompleted;
  for (let c = 0; c < LedgerCategory.COUNT; c++) {
    economy.thisMonth[c] = ledger.monthlyTotals[c];
    economy.lastMonth[c] = completedMonthTotal(ledger, c);
    for (let m = 0; m < HISTORY_MONTHS; m++) {
      economy.pastMonths[m][c] = completedMonthTotal(ledger, c, m);
    }
  }
  economy.rideUpkeepPerFortnight = ledger.inputs.rideUpkeepPerFortnight;
  const research = world.research;
  const nextIndex = nextEligibleInvention(research);
  const current = research.inventions[nextIndex];
  const currentProgress = nextIndex === research.currentIndex ? research.progress : 0;
  out.research.funding = research.funding;
  out.research.enabledCategoryMask = research.enabledCategoryMask;
  out.research.progress = current ? currentProgress : 0;
  out.research.currentCost = current ? current.workUnits : -1;
  out.research.currentItemId = current?.itemId ?? -1;
  out.research.progressStage = current
    ? 3 * currentProgress < current.workUnits
      ? 'Initial research'
      : 3 * currentProgress < current.workUnits * 2
        ? 'Designing'
        : 'Completing design'
    : '';
  out.research.inventionCount = research.inventions.length;
  out.research.unlockedCount = research.unlocked.size;
  out.research.unlockedRides.fill(0);
  for (const id of research.unlocked) if (id < RIDE_TYPE_SLOTS) out.research.unlockedRides[id] = 1;
}
