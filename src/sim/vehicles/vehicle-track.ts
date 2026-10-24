export const enum VehicleSegmentFlag {
  ChainLift = 1 << 0,
  Launch = 1 << 1,
  Brake = 1 << 2,
  Block = 1 << 3,
  Station = 1 << 4,
  DropStart = 1 << 5,
  Crest = 1 << 6,
  Inversion = 1 << 7,
}

export interface VehicleTrackInput {
  rideId: number;
  /** World-space integer x/y/z triples; one line segment connects each adjacent pair. */
  points: Int32Array;
  segmentFlags: Uint16Array;
  /** Signed Q8 curvature (1 / world unit) for force estimation. */
  lateralCurvatureQ8?: Int16Array;
  verticalCurvatureQ8?: Int16Array;
  /** A zero marks a block section that currently cannot accept a train. */
  blockOpen?: Uint8Array;
  loop?: boolean;
  crashable?: boolean;
  /** Q8 speed limits for rides whose cars can detach at the respective transition. */
  crestCrashSpeedQ8?: number;
  dropCrashSpeedQ8?: number;
}

export interface VehicleTrack extends Required<VehicleTrackInput> {
  segmentLengths: Uint32Array;
  cumulativeLengthsQ8: Uint32Array;
  totalLengthQ8: number;
  dropHeights: Uint16Array;
  /** Train occupying each block segment, or -1 when the section is empty. */
  blockOccupiedBy: Int32Array;
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
  const segmentLengths = new Uint32Array(segmentCount);
  const cumulativeLengthsQ8 = new Uint32Array(segmentCount + 1);
  const dropHeights = new Uint16Array(segmentCount);
  let highestZ = input.points[2];
  for (let segment = 0; segment < segmentCount; segment++) {
    const a = segment * 3;
    const dx = input.points[a + 3] - input.points[a];
    const dy = input.points[a + 4] - input.points[a + 1];
    const dz = input.points[a + 5] - input.points[a + 2];
    const length = integerSqrt(dx * dx + dy * dy + dz * dz);
    if (length === 0) throw new Error('Track segments must have non-zero length');
    segmentLengths[segment] = length;
    cumulativeLengthsQ8[segment + 1] = cumulativeLengthsQ8[segment] + (length << 8);
    if (dz > 0) highestZ = Math.max(highestZ, input.points[a + 5]);
    if (dz < 0) {
      dropHeights[segment] = Math.min(0xffff, Math.max(0, highestZ - input.points[a + 5]));
    }
    if (input.points[a + 5] > highestZ) highestZ = input.points[a + 5];
  }
  return {
    rideId: input.rideId,
    points: input.points,
    segmentFlags: input.segmentFlags,
    lateralCurvatureQ8: normalize(input.lateralCurvatureQ8, Int16Array),
    verticalCurvatureQ8: normalize(input.verticalCurvatureQ8, Int16Array),
    blockOpen,
    loop: input.loop ?? false,
    crashable: input.crashable ?? false,
    crestCrashSpeedQ8: input.crestCrashSpeedQ8 ?? 50 * 256,
    dropCrashSpeedQ8: input.dropCrashSpeedQ8 ?? 64 * 256,
    segmentLengths,
    cumulativeLengthsQ8,
    totalLengthQ8: cumulativeLengthsQ8[segmentCount],
    dropHeights,
    blockOccupiedBy: new Int32Array(segmentCount).fill(-1),
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

  all(): readonly VehicleTrack[] {
    return this.trackList;
  }
}
