import type { World } from '../core/world';
import { PIECES, TANGENT_ONE } from '../track/catalog';
import { getTrackPath } from '../track/track-path';
import { MAX_TRACK_RIDES } from '../track/track-store';
import { PieceFlag, PieceMode } from '../track/track-types';
import type { TrackPath } from '../track/track-path';
import { RIDE_CATALOG } from '../rides/ride-types';
import type { RideType } from '../rides/ride-types';
import { CREST_CRASH_SPEED_Q8, DROP_CRASH_SPEED_Q8 } from './speed-units';
import { measureTrackElements, NO_TRACK_ELEMENTS } from './track-elements';
import type { TrackElementStats } from './vehicle-ratings';

export const enum VehicleSegmentFlag {
  ChainLift = 1 << 0,
  Launch = 1 << 1,
  Brake = 1 << 2,
  Block = 1 << 3,
  Station = 1 << 4,
  DropStart = 1 << 5,
  Crest = 1 << 6,
  Inversion = 1 << 7,
  /** Every segment of a station piece; the drive that moves a dispatched train out. */
  StationDrive = 1 << 8,
}

export interface VehicleTrackInput {
  rideId: number;
  /** World-space integer x/y/z triples; one line segment connects each adjacent pair. */
  points: Int32Array;
  segmentFlags: Uint16Array;
  /**
   * Extra fractional bits of the curvature arrays below: a value is `curvature * 256 * 2^shift`.
   * Path-built tracks use finer curvature so gentle curves are not rounded to zero.
   */
  curvatureShift?: number;
  /** Signed Q8 curvature (1 / world unit) for force estimation. */
  lateralCurvatureQ8?: Int16Array;
  verticalCurvatureQ8?: Int16Array;
  /** Q8 sine/cosine of track bank angle; defaults to level track. */
  bankSinQ8?: Int16Array;
  bankCosQ8?: Int16Array;
  /** Nonzero while the track's up direction is inverted, independent of event markers. */
  invertedSegments?: Uint8Array;
  /** A zero marks a block section that currently cannot accept a train. */
  blockOpen?: Uint8Array;
  loop?: boolean;
  /** Crest, drop-start and train-collision crashes apply; defaults to true. */
  crashable?: boolean;
  /** Turn, helix and shelter counts for the rating terms; defaults to none. */
  elements?: TrackElementStats;
  /** Q8 speed limits for rides whose cars can detach at the respective transition. */
  crestCrashSpeedQ8?: number;
  dropCrashSpeedQ8?: number;
  sourceVersion?: number;
}

export interface VehicleTrack extends Required<VehicleTrackInput> {
  segmentLengths: Uint32Array;
  cumulativeLengthsQ8: Uint32Array;
  totalLengthQ8: number;
  dropHeights: Uint16Array;
  /** Train occupying each block segment, or -1 when the section is empty. */
  blockOccupiedBy: Int32Array;
  /** Start index shared by adjacent segments that make up the same block section. */
  blockSectionStart: Uint32Array;
  /** First segment carrying the `Station` flag, or -1. */
  stationSegment: number;
  /** End of the contiguous station drive segments, in Q8 arclength; -1 without a station. */
  stationEndQ8: number;
  /** Segment index just past the station, or -1. */
  stationEndSegment: number;
  /**
   * Block-section boundaries of a loop, ascending Q8 arclength: the end of the station and of each
   * block-brake run. Zone k spans (boundary k-1, boundary k]; a zone holds one train at a time.
   */
  boundariesQ8: Int32Array;
}

/** Fewer than two boundaries cannot separate trains. */
export function maxTrainsOnTrack(track: VehicleTrack): number {
  return track.boundariesQ8.length >= 2 ? track.boundariesQ8.length - 1 : 1;
}

const PATH_CURVATURE_SHIFT = 6;
const CURVATURE_SCALE = 256 << PATH_CURVATURE_SHIFT;

function boundedQ8(value: number): number {
  return Math.max(-0x8000, Math.min(0x7fff, value));
}

/** Speed no train reaches: crest and drop checks of rides whose cars are attached never fire. */
const NO_CRASH_SPEED_Q8 = 0x7fffffff;

function rideCrashRules(world: World, rideId: number) {
  const slot = world.rides.idToSlot[rideId];
  const rules =
    slot >= 0 ? RIDE_CATALOG[world.rides.cols.typeId[slot] as RideType]?.trackRules : undefined;
  const unattached = rules?.unattachedCars ?? true;
  return {
    crashable: rules?.crashable ?? true,
    crestCrashSpeedQ8: unattached ? CREST_CRASH_SPEED_Q8 : NO_CRASH_SPEED_Q8,
    dropCrashSpeedQ8: unattached ? DROP_CRASH_SPEED_Q8 : NO_CRASH_SPEED_Q8,
  };
}

/** Converts the track subsystem's cached polyline into the vehicle system's compact tick input. */
export function createVehicleTrackFromPath(world: World, path: TrackPath): VehicleTrack {
  const segmentCount = path.count - 1;
  const points = new Int32Array(path.count * 3);
  for (let point = 0; point < path.count; point++) {
    const offset = point * 3;
    points[offset] = path.x[point];
    points[offset + 1] = path.y[point];
    points[offset + 2] = path.z[point];
  }

  const segmentFlags = new Uint16Array(segmentCount);
  const lateralCurvatureQ8 = new Int16Array(segmentCount);
  const verticalCurvatureQ8 = new Int16Array(segmentCount);
  const bankSinQ8 = new Int16Array(segmentCount);
  const bankCosQ8 = new Int16Array(segmentCount);
  const invertedSegments = new Uint8Array(segmentCount);
  const pieceCols = world.track.pieces.cols;
  let currentPiece = -1;
  let entryTx = 0;
  let entryTy = 0;
  let entryTz = 0;
  for (let segment = 0; segment < segmentCount; segment++) {
    const pieceId = path.piece[segment];
    const pieceSlot = world.track.pieces.idToSlot[pieceId];
    const pieceDef = PIECES[pieceCols.pieceType[pieceSlot]];
    const firstPieceSegment = pieceId !== currentPiece;
    const mode = pieceCols.mode[pieceSlot];
    if (firstPieceSegment) {
      currentPiece = pieceId;
      entryTx = path.tx[segment];
      entryTy = path.ty[segment];
      entryTz = path.tz[segment];
    }
    if (mode === PieceMode.ChainLift) segmentFlags[segment] |= VehicleSegmentFlag.ChainLift;
    if (mode === PieceMode.Brake) segmentFlags[segment] |= VehicleSegmentFlag.Brake;
    if (mode === PieceMode.BlockBrake) segmentFlags[segment] |= VehicleSegmentFlag.Block;
    if (mode === PieceMode.Launch) segmentFlags[segment] |= VehicleSegmentFlag.Launch;
    if (pieceDef.flags & PieceFlag.Station)
      segmentFlags[segment] |= VehicleSegmentFlag.StationDrive;
    if (firstPieceSegment) {
      if (pieceDef.flags & PieceFlag.Station) segmentFlags[segment] |= VehicleSegmentFlag.Station;
      if (pieceDef.flags & PieceFlag.Crest) segmentFlags[segment] |= VehicleSegmentFlag.Crest;
      if (pieceDef.flags & PieceFlag.DropStart)
        segmentFlags[segment] |= VehicleSegmentFlag.DropStart;
      if (pieceDef.flags & PieceFlag.Inverted)
        segmentFlags[segment] |= VehicleSegmentFlag.Inversion;
    }
    const tangentDot =
      path.tx[segment] * entryTx + path.ty[segment] * entryTy + path.tz[segment] * entryTz;
    invertedSegments[segment] = pieceDef.flags & PieceFlag.Inverted && tangentDot < 0 ? 1 : 0;

    const bankRadians = (path.bank[segment] * Math.PI) / 180;
    bankSinQ8[segment] = boundedQ8(Math.round(Math.sin(bankRadians) * 256));
    bankCosQ8[segment] = boundedQ8(Math.round(Math.cos(bankRadians) * 256));

    const distance = Math.max(1, path.s[segment + 1] - path.s[segment]);
    const tangentOffset = segment + 1;
    const horizontalCross =
      path.tx[segment] * path.ty[tangentOffset] - path.ty[segment] * path.tx[tangentOffset];
    lateralCurvatureQ8[segment] = boundedQ8(
      Math.trunc((horizontalCross * CURVATURE_SCALE) / (TANGENT_ONE * TANGENT_ONE * distance)),
    );
    const horizontalStart = Math.round(Math.hypot(path.tx[segment], path.ty[segment]));
    const horizontalEnd = Math.round(Math.hypot(path.tx[tangentOffset], path.ty[tangentOffset]));
    const verticalCross =
      horizontalStart * path.tz[tangentOffset] - path.tz[segment] * horizontalEnd;
    verticalCurvatureQ8[segment] = boundedQ8(
      Math.trunc((verticalCross * CURVATURE_SCALE) / (TANGENT_ONE * TANGENT_ONE * distance)),
    );
  }

  return createVehicleTrack({
    rideId: path.rideId,
    points,
    segmentFlags,
    lateralCurvatureQ8,
    verticalCurvatureQ8,
    bankSinQ8,
    bankCosQ8,
    invertedSegments,
    curvatureShift: PATH_CURVATURE_SHIFT,
    loop: path.closed,
    ...rideCrashRules(world, path.rideId),
    elements: measureTrackElements(world, path),
    sourceVersion: path.version,
  });
}

function integerSqrt(value: number): number {
  if (value <= 0) return 0;
  let x = value;
  let y = Math.floor((x + 1) / 2);
  while (y < x) {
    x = y;
    y = Math.floor((x + Math.floor(value / x)) / 2);
  }
  return x;
}

export function createVehicleTrack(input: VehicleTrackInput): VehicleTrack {
  if (input.points.length < 6 || input.points.length % 3 !== 0) {
    throw new Error('A vehicle track needs at least two xyz points');
  }
  const segmentCount = input.points.length / 3 - 1;
  if (input.segmentFlags.length !== segmentCount) {
    throw new Error('Track segment flags must match the number of line segments');
  }
  if (input.loop) {
    const last = input.points.length - 3;
    if (
      input.points[0] !== input.points[last] ||
      input.points[1] !== input.points[last + 1] ||
      input.points[2] !== input.points[last + 2]
    ) {
      throw new Error('Loop tracks must return to their starting point');
    }
  }
  const normalize = <T extends Int16Array | Uint8Array>(
    values: T | undefined,
    Ctor: { new (length: number): T },
  ): T => {
    if (values && values.length !== segmentCount) {
      throw new Error('Track segment metadata must match the number of line segments');
    }
    return values ?? new Ctor(segmentCount);
  };
  const blockOpen = input.blockOpen ?? new Uint8Array(segmentCount).fill(1);
  if (blockOpen.length !== segmentCount) {
    throw new Error('Track segment metadata must match the number of line segments');
  }
  const bankSinQ8 = normalize(input.bankSinQ8, Int16Array);
  const bankCosQ8 = input.bankCosQ8 ?? new Int16Array(segmentCount).fill(256);
  const invertedSegments = input.invertedSegments ?? new Uint8Array(segmentCount);
  if (bankCosQ8.length !== segmentCount || invertedSegments.length !== segmentCount) {
    throw new Error('Track segment metadata must match the number of line segments');
  }
  const segmentLengths = new Uint32Array(segmentCount);
  const cumulativeLengthsQ8 = new Uint32Array(segmentCount + 1);
  const dropHeights = new Uint16Array(segmentCount);
  const blockSectionStart = new Uint32Array(segmentCount);
  for (let segment = 0; segment < segmentCount; segment++) {
    const a = segment * 3;
    const dx = input.points[a + 3] - input.points[a];
    const dy = input.points[a + 4] - input.points[a + 1];
    const dz = input.points[a + 5] - input.points[a + 2];
    const length = integerSqrt(dx * dx + dy * dy + dz * dz);
    if (length === 0) throw new Error('Track segments must have non-zero length');
    segmentLengths[segment] = length;
    cumulativeLengthsQ8[segment + 1] = cumulativeLengthsQ8[segment] + (length << 8);
    blockSectionStart[segment] =
      input.segmentFlags[segment] & VehicleSegmentFlag.Block &&
      segment > 0 &&
      input.segmentFlags[segment - 1] & VehicleSegmentFlag.Block
        ? blockSectionStart[segment - 1]
        : segment;
  }
  for (let segment = 0; segment < segmentCount; segment++) {
    if (!(input.segmentFlags[segment] & VehicleSegmentFlag.DropStart)) continue;
    const start = segment * 3;
    let peakZ = input.points[start + 2];
    let crestPoint = segment;
    while (crestPoint > 0) {
      const previousZ = input.points[(crestPoint - 1) * 3 + 2];
      if (previousZ <= peakZ) break;
      peakZ = previousZ;
      crestPoint--;
    }
    let lowZ = input.points[start + 2];
    for (let descent = segment; descent < segmentCount; descent++) {
      const point = descent * 3;
      const endZ = input.points[point + 5];
      if (endZ >= input.points[point + 2]) break;
      lowZ = Math.min(lowZ, endZ);
    }
    dropHeights[segment] = Math.min(0xffff, Math.max(0, peakZ - lowZ));
  }
  const stationSegment = input.segmentFlags.findIndex(
    (flags) => (flags & VehicleSegmentFlag.Station) !== 0,
  );
  let stationEndSegment = -1;
  if (stationSegment >= 0) {
    stationEndSegment = stationSegment;
    while (
      stationEndSegment < segmentCount &&
      input.segmentFlags[stationEndSegment] & VehicleSegmentFlag.StationDrive
    ) {
      stationEndSegment++;
    }
  }
  const ends: number[] = [];
  if (input.loop) {
    if (stationEndSegment >= 0) ends.push(cumulativeLengthsQ8[stationEndSegment]);
    for (let segment = 0; segment < segmentCount; segment++) {
      if (!(input.segmentFlags[segment] & VehicleSegmentFlag.Block)) continue;
      const next = segment + 1;
      if (next < segmentCount && input.segmentFlags[next] & VehicleSegmentFlag.Block) continue;
      ends.push(cumulativeLengthsQ8[next]);
    }
  }
  const boundariesQ8 = Int32Array.from(ends);
  boundariesQ8.sort();
  return {
    rideId: input.rideId,
    points: input.points,
    segmentFlags: input.segmentFlags,
    curvatureShift: input.curvatureShift ?? 0,
    lateralCurvatureQ8: normalize(input.lateralCurvatureQ8, Int16Array),
    verticalCurvatureQ8: normalize(input.verticalCurvatureQ8, Int16Array),
    bankSinQ8,
    bankCosQ8,
    invertedSegments,
    blockOpen,
    loop: input.loop ?? false,
    crashable: input.crashable ?? true,
    elements: input.elements ?? NO_TRACK_ELEMENTS,
    crestCrashSpeedQ8: input.crestCrashSpeedQ8 ?? CREST_CRASH_SPEED_Q8,
    dropCrashSpeedQ8: input.dropCrashSpeedQ8 ?? DROP_CRASH_SPEED_Q8,
    sourceVersion: input.sourceVersion ?? -1,
    segmentLengths,
    cumulativeLengthsQ8,
    totalLengthQ8: cumulativeLengthsQ8[segmentCount],
    dropHeights,
    blockOccupiedBy: new Int32Array(segmentCount).fill(-1),
    blockSectionStart,
    stationSegment,
    stationEndQ8: stationEndSegment >= 0 ? cumulativeLengthsQ8[stationEndSegment] : -1,
    stationEndSegment,
    boundariesQ8,
  };
}

/** A cold lookup table populated when track layout changes, never during the tick loop. */
export class VehicleTrackRegistry {
  private readonly byRide = new Map<number, VehicleTrack>();
  private readonly trackList: VehicleTrack[] = [];

  constructor(tracks: readonly VehicleTrack[] = []) {
    for (const track of tracks) this.set(track);
  }

  set(track: VehicleTrack): void {
    const current = this.byRide.get(track.rideId);
    if (!current) this.trackList.push(track);
    else this.trackList[this.trackList.indexOf(current)] = track;
    this.byRide.set(track.rideId, track);
  }

  get(rideId: number): VehicleTrack | undefined {
    return this.byRide.get(rideId);
  }

  delete(rideId: number): void {
    const current = this.byRide.get(rideId);
    if (!current) return;
    this.byRide.delete(rideId);
    this.trackList.splice(this.trackList.indexOf(current), 1);
  }

  all(): readonly VehicleTrack[] {
    return this.trackList;
  }
}

/** Refreshes only changed paths; geometry work stays outside the vehicle tick loop. */
export function syncVehicleTracks(world: World, tracks: VehicleTrackRegistry): void {
  for (let rideId = 0; rideId < MAX_TRACK_RIDES; rideId++) {
    const path = getTrackPath(world, rideId);
    if (!path) {
      if (tracks.get(rideId)?.sourceVersion !== -1) tracks.delete(rideId);
      continue;
    }
    if (tracks.get(rideId)?.sourceVersion !== path.version) {
      tracks.set(createVehicleTrackFromPath(world, path));
    }
  }
}
