import type { World } from '../sim/core/world';
import type { EntityStore, Schema } from '../sim/core/entity-store';
import { RIDE_CATALOG } from '../sim/rides/ride-types';
import type { RideType } from '../sim/rides/ride-types';
import type { CommandFeedback } from '../sim/core/feedback';
import { recountRideLines } from '../sim/guests/ride-lines';
import { getConstructionCursor } from '../sim/track/construction';
import { MAX_TRACK_PIECES, MAX_TRACK_RIDES } from '../sim/track/track-store';
import { ScenarioStatus } from '../sim/scenario/scenario';
import type { ScenarioObjective } from '../sim/scenario/scenario';
import { objectiveMetric } from '../sim/scenario/scenario-system';

/** Ints per entity in a layer: fixed-point x, y, z, then layer-specific render metadata. */
export const SNAPSHOT_STRIDE = 4;
export const SNAPSHOT_RIDE_CAPACITY = 256;
export const SNAPSHOT_TRACK_CAPACITY = MAX_TRACK_PIECES;

/** Ints per ride in `Snapshot.rideInfo`; index with `RideInfo`. */
export const RIDE_INFO_STRIDE = 16;

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
  /** Tile and height level where the next piece attaches (valid when the cursor has track). */
  CursorX = 12,
  CursorY = 13,
  CursorZ = 14,
  /** Packed by `encodeCursor`. */
  Cursor = 15,
}

export const enum RideFlag {
  EntrancePlaced = 1 << 0,
  ExitPlaced = 1 << 1,
  QueueConnected = 1 << 2,
  Tested = 1 << 3,
  CircuitClosed = 1 << 4,
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

export interface Snapshot {
  tick: number;
  guests: SnapshotLayer;
  staff: SnapshotLayer;
  /** Stable staff id per staff slot, in the same order as `staff`. */
  staffIds: Int32Array;
  /** Player-given staff names by staff id. */
  staffNames: ReadonlyMap<number, string>;
  vehicles: SnapshotLayer;
  litter: SnapshotLayer;
  rides: SnapshotLayer;
  tracks: SnapshotLayer;
  /** `RIDE_INFO_STRIDE` ints per ride, in the same order as `rides`. */
  rideInfo: Int32Array;
  /** Outcome of the latest player command. */
  feedback: CommandFeedback;
  buildable: Uint8Array;
  /** Per-tile grass overgrowth and flower-bed bits (see staff/grounds.ts). */
  grounds: Uint8Array;
  park: { cash: number; loan: number; rides: number };
  scenario: SnapshotScenario;
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
  litter: number;
  rides?: number;
  tracks?: number;
  mapTiles?: number;
}

export function createSnapshot(caps: SnapshotCapacities): Snapshot {
  const layer = (n: number): SnapshotLayer => ({
    count: 0,
    data: new Int32Array(n * SNAPSHOT_STRIDE),
  });
  return {
    tick: 0,
    guests: layer(caps.guests),
    staff: layer(caps.staff),
    staffIds: new Int32Array(caps.staff),
    staffNames: new Map(),
    vehicles: layer(caps.vehicles),
    litter: layer(caps.litter),
    rides: layer(caps.rides ?? SNAPSHOT_RIDE_CAPACITY),
    tracks: layer(caps.tracks ?? SNAPSHOT_TRACK_CAPACITY),
    rideInfo: new Int32Array((caps.rides ?? SNAPSHOT_RIDE_CAPACITY) * RIDE_INFO_STRIDE),
    feedback: { seq: 0, domain: 0, code: 0, subject: -1 },
    buildable: new Uint8Array(caps.mapTiles ?? 0),
    grounds: new Uint8Array(caps.mapTiles ?? 0),
    park: { cash: 0, loan: 0, rides: 0 },
    scenario: { status: ScenarioStatus.Active, objective: null, metric: 0, parkRating: 0 },
  };
}

export function snapshotBuffers(s: Snapshot): ArrayBuffer[] {
  return [s.guests, s.staff, s.vehicles, s.litter, s.rides, s.tracks]
    .map((l) => l.data.buffer as ArrayBuffer)
    .concat(
      s.rideInfo.buffer as ArrayBuffer,
      s.buildable.buffer as ArrayBuffer,
      s.grounds.buffer as ArrayBuffer,
      s.staffIds.buffer as ArrayBuffer,
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
    (trackRide && world.track.closed[rideId] ? RideFlag.CircuitClosed : 0);
  info[o + RideInfo.GuestsServed] = r.guestsServed[slot];
  info[o + RideInfo.Price] = r.price[slot];
  info[o + RideInfo.TrackPieces] = trackRide ? world.track.count[rideId] : 0;
  if (!RIDE_CATALOG[r.typeId[slot] as RideType]?.usesTrack) {
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

export function writeSnapshot(world: World, out: Snapshot): void {
  out.tick = world.tick;
  recountRideLines(world);
  const buildableCount = Math.min(world.map.ownership.length, out.buildable.length);
  for (let i = 0; i < buildableCount; i++) out.buildable[i] = world.map.canBuild(i) ? 1 : 0;
  writeLayer(out.guests, world.guests, world.guests.cols.tint, world.guests.cols.state);
  writeLayer(out.staff, world.staff, world.staff.cols.kind, world.staff.cols.state);
  const staffIdCount = Math.min(world.staff.count, out.staffIds.length);
  for (let i = 0; i < staffIdCount; i++) out.staffIds[i] = world.staff.slotToId[i];
  out.staffNames = world.staffNames;
  const groundCount = Math.min(world.grounds.length, out.grounds.length);
  out.grounds.set(world.grounds.subarray(0, groundCount));
  writeLayer(out.vehicles, world.vehicles, world.vehicles.cols.state, null);
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
    trackData[o + 2] = trackPieces.cols.z[i] * 64;
    trackData[o + 3] =
      (trackPieces.cols.rideId[i] << 16) |
      (trackPieces.cols.dir[i] << 8) |
      (trackPieces.cols.pieceType[i] & 0xff);
  }
  out.tracks.count = trackCount;
  const feedback = world.feedback;
  out.feedback.seq = feedback.seq;
  out.feedback.domain = feedback.domain;
  out.feedback.code = feedback.code;
  out.feedback.subject = feedback.subject;
  out.park.cash = world.economy.cash;
  out.park.loan = world.economy.loan;
  out.park.rides = rides.count;
  const scenario = world.scenario;
  out.scenario.status = scenario.status;
  out.scenario.objective = scenario.objective ? { ...scenario.objective } : null;
  out.scenario.metric = scenario.objective ? objectiveMetric(world, scenario.objective) : 0;
  out.scenario.parkRating = world.economy.parkRating;
}
