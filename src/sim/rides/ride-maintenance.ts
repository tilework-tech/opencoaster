import type { World } from '../core/world';
import { WeatherKind } from '../weather/weather';
import { StaffKind } from '../staff/staff-store';
import { breakDownRide, holdRideTrains, releaseHeldTrains } from './coaster';
import { BreakdownReason, holdsRidersAboard, repairTicksFor } from './breakdown-reasons';
import type { BreakdownWeight } from './breakdown-reasons';
import { RidePhase, RideState } from './ride-store';
import { INSPECTION_MINUTE_TICKS, RIDE_CATALOG } from './ride-types';
import type { RideType } from './ride-types';
import { RideMode } from './ride-modes';
import { rideTrainSlots } from '../vehicles/ride-trains';

/** Full reliability (100%) and the top of the scale, which keeps the byte below the percent. */
export const RELIABILITY_FULL = 100 * 256;
export const RELIABILITY_MAX = 25_855;
/** Reliability wears and breakdowns are rolled once per this many global ticks. */
export const RELIABILITY_CHECK_TICKS = 256;

/** A breakdown succeeds for `BREAKDOWN_ROLL_BASE - reliability` of `BREAKDOWN_ROLL_RANGE` rolls. */
const BREAKDOWN_ROLL_RANGE = 2_097_152;
const BREAKDOWN_ROLL_BASE = 25_857;

const MONTHS_PER_YEAR = 8;
/**
 * Extra wear per check as a fraction (numerator over `AGE_PENALTY_DENOMINATOR`) of the ride type's
 * unreliability factor, by year of age; the last entry holds for every later year.
 */
const AGE_PENALTY_DENOMINATOR = 8;
const AGE_PENALTY_EIGHTHS_BY_YEAR: readonly number[] = [0, 1, 2, 4, 4, 8, 8, 8, 16];

/** The downtime window: counts per window, and the number of windows that feed the percent. */
export const DOWNTIME_WINDOW_TICKS = 8192;
const DOWNTIME_WINDOWS = 8;
const DOWNTIME_COUNT_LIMIT = 255;

/** A ride younger than this many months cannot suffer a brakes failure. */
const BRAKES_FAILURE_MIN_AGE_MONTHS = 16;
/** A ride above this reliability percentage cannot suffer a brakes failure. */
const BRAKES_FAILURE_MAX_RELIABILITY_PERCENT = 50;

/** A mechanic's walking energy (the default for a new hire), which scales what a repair restores. */
const MECHANIC_ENERGY = 96;
const REPAIR_RESTORE_DIVISOR = 2;

/** Ticks a mechanic spends at the ride on a routine inspection. */
export const INSPECTION_WORK_TICKS = 240;
/**
 * Longest gap between two mechanic updates that still counts as the same visit. Staff act every
 * 16th tick, so two missed updates mean the mechanic left.
 */
const SERVICE_CONTINUITY_TICKS = 32;
const INSPECTION_RESTORE_DIVISOR = 4;
const INSPECTION_RESTORE_BYTE_RANGE = 256;
/** Reliability a forced breakdown costs, in percentage points. */
const FORCED_BREAKDOWN_RELIABILITY_LOSS = 20;
/** Brakes failure weight while it rains, replacing the type's dry weight. */
const WET_BRAKES_FAILURE_WEIGHT = 20;

function isActiveCycle(phase: number): boolean {
  return (
    phase === RidePhase.Loading || phase === RidePhase.Running || phase === RidePhase.Unloading
  );
}

function syncReliabilityPercent(world: World, slot: number): void {
  const ride = world.rides.cols;
  ride.reliability[slot] = Math.min(100, Math.floor(ride.reliabilityRaw[slot] / 256));
}

function wearPerCheck(unreliability: number, ageMonths: number): number {
  const year = Math.floor(ageMonths / MONTHS_PER_YEAR);
  const eighths =
    AGE_PENALTY_EIGHTHS_BY_YEAR[Math.min(year, AGE_PENALTY_EIGHTHS_BY_YEAR.length - 1)];
  return unreliability + Math.floor((unreliability * eighths) / AGE_PENALTY_DENOMINATOR);
}

function isBroken(world: World, slot: number): boolean {
  const ride = world.rides.cols;
  return ride.state[slot] === RideState.Broken || ride.phase[slot] === RidePhase.Broken;
}

/**
 * Whether a roll for brakes failure is thrown away: the ride is too new, still too reliable, or
 * a block-sectioned circuit running more than one train.
 */
function brakesFailureDiscarded(world: World, slot: number): boolean {
  const ride = world.rides.cols;
  if (ride.ageMonths[slot] < BRAKES_FAILURE_MIN_AGE_MONTHS) return true;
  if (ride.reliability[slot] > BRAKES_FAILURE_MAX_RELIABILITY_PERCENT) return true;
  if (ride.mode[slot] !== RideMode.ContinuousCircuitBlockSectioned) return false;
  const trains =
    ride.trainCount[slot] > 0
      ? ride.trainCount[slot]
      : rideTrainSlots(world, world.rides.slotToId[slot]).length;
  return trains > 1;
}

/** The type's failure weights for the current weather; rain makes brakes failure far likelier. */
export function breakdownReasonWeights(type: RideType, weather: WeatherKind): BreakdownWeight[] {
  const wet = weather === WeatherKind.Rain || weather === WeatherKind.Storm;
  return RIDE_CATALOG[type].breakdowns.map((entry) =>
    wet && entry.reason === BreakdownReason.BrakesFailure
      ? { reason: entry.reason, weight: WET_BRAKES_FAILURE_WEIGHT }
      : entry,
  );
}

/** Picks the failure for a successful roll, or `None` when the pick is discarded. */
function pickReason(world: World, slot: number): BreakdownReason {
  const weights = breakdownReasonWeights(
    world.rides.cols.typeId[slot] as RideType,
    world.weather.kind,
  );
  let total = 0;
  for (const entry of weights) total += entry.weight;
  let roll = world.rng.int(total);
  let reason = weights[weights.length - 1].reason;
  for (const entry of weights) {
    if (roll < entry.weight) {
      reason = entry.reason;
      break;
    }
    roll -= entry.weight;
  }
  return reason === BreakdownReason.BrakesFailure && brakesFailureDiscarded(world, slot)
    ? BreakdownReason.None
    : reason;
}

/**
 * Takes the ride out of service for `reason`. Riders get off at once unless the failure locks
 * restraints or doors shut, in which case they stay aboard until a mechanic repairs it.
 */
export function breakRide(world: World, slot: number, reason: BreakdownReason): void {
  const ride = world.rides.cols;
  ride.breakdownReason[slot] = reason;
  ride.serviceTicks[slot] = 0;
  if (RIDE_CATALOG[ride.typeId[slot] as RideType].usesTrack) {
    if (holdsRidersAboard(reason)) holdRideTrains(world, slot);
    else breakDownRide(world, slot);
    ride.phase[slot] = RidePhase.Broken;
    return;
  }
  const occupied = isActiveCycle(ride.phase[slot]) && ride.boarded[slot] > 0;
  if (occupied && !holdsRidersAboard(reason)) releaseRiders(world, slot);
  ride.state[slot] = RideState.Broken;
  ride.phase[slot] = RidePhase.Broken;
  ride.phaseTicks[slot] = 0;
  ride.waitTicks[slot] = 0;
  ride.breakdownCounter[slot]++;
}

function releaseRiders(world: World, slot: number): void {
  const ride = world.rides.cols;
  ride.cyclesCompleted[slot]++;
  ride.guestsServed[slot] += ride.boarded[slot];
  ride.boarded[slot] = 0;
}

function countDowntimeCheck(world: World, slot: number): void {
  const ride = world.rides.cols;
  if (ride.downtimeBucket0[slot] < DOWNTIME_COUNT_LIMIT) ride.downtimeBucket0[slot]++;
}

/** Publishes the rolling percent from the buckets, then shifts them so a new window starts. */
function rollDowntimeWindow(world: World, slot: number): void {
  const ride = world.rides.cols;
  const buckets = [
    ride.downtimeBucket0,
    ride.downtimeBucket1,
    ride.downtimeBucket2,
    ride.downtimeBucket3,
    ride.downtimeBucket4,
    ride.downtimeBucket5,
    ride.downtimeBucket6,
    ride.downtimeBucket7,
  ];
  let total = 0;
  for (let i = 0; i < DOWNTIME_WINDOWS; i++) total += buckets[i][slot];
  ride.downtimePercent[slot] = Math.min(100, Math.floor(total / 2));
  for (let i = DOWNTIME_WINDOWS - 1; i > 0; i--) buckets[i][slot] = buckets[i - 1][slot];
  buckets[0][slot] = 0;
}

/**
 * Once per check interval every open ride that can break down loses reliability, older rides
 * faster, and rolls for a failure; zero reliability always fails. Every ride also counts a broken
 * check toward its downtime, and at each window boundary the rolling downtime is refreshed.
 */
export function updateRideMaintenance(world: World): void {
  if (world.tick % RELIABILITY_CHECK_TICKS !== 0) return;
  const windowEnds = world.tick % DOWNTIME_WINDOW_TICKS === 0;
  const ride = world.rides.cols;
  for (let slot = 0; slot < world.rides.count; slot++) {
    const broken = isBroken(world, slot);
    if (broken) countDowntimeCheck(world, slot);
    if (windowEnds) rollDowntimeWindow(world, slot);

    const def = RIDE_CATALOG[ride.typeId[slot] as RideType];
    if (!def) continue;
    if (def.breakdowns.length === 0) {
      ride.reliabilityRaw[slot] = RELIABILITY_MAX;
      syncReliabilityPercent(world, slot);
      continue;
    }
    if (broken || ride.state[slot] !== RideState.Open) continue;

    const wear = wearPerCheck(def.unreliability, ride.ageMonths[slot]);
    ride.reliabilityRaw[slot] = Math.max(0, ride.reliabilityRaw[slot] - wear);
    syncReliabilityPercent(world, slot);

    const reliability = ride.reliabilityRaw[slot];
    if (
      reliability === 0 ||
      world.rng.int(BREAKDOWN_ROLL_RANGE) < BREAKDOWN_ROLL_BASE - reliability
    ) {
      const reason = pickReason(world, slot);
      if (reason !== BreakdownReason.None) breakRide(world, slot, reason);
    }
  }
}

/** Forces a breakdown of an open ride, for tests and scripted scenarios. */
export function triggerRideBreakdown(
  world: World,
  rideId: number,
  reason: BreakdownReason = BreakdownReason.SafetyCutOut,
): boolean {
  const slot = world.rides.idToSlot[rideId] ?? -1;
  if (slot < 0 || world.rides.cols.state[slot] !== RideState.Open) return false;
  const ride = world.rides.cols;
  ride.reliabilityRaw[slot] = Math.max(
    0,
    ride.reliabilityRaw[slot] - FORCED_BREAKDOWN_RELIABILITY_LOSS * 256,
  );
  syncReliabilityPercent(world, slot);
  breakRide(world, slot, reason);
  return true;
}

function mechanicSlot(world: World, staffId: number): number {
  const slot = world.staff.idToSlot[staffId] ?? -1;
  return slot >= 0 && world.staff.cols.kind[slot] === StaffKind.Mechanic ? slot : -1;
}

/**
 * A repair restores the mechanic's energy times half the missing reliability percent, in raw
 * units, so a poorly maintained ride recovers the most.
 */
function restoreReliabilityAfterRepair(world: World, slot: number): void {
  const ride = world.rides.cols;
  const missingPercent = 100 - Math.min(100, Math.floor(ride.reliabilityRaw[slot] / 256));
  const gain = MECHANIC_ENERGY * Math.floor(missingPercent / REPAIR_RESTORE_DIVISOR);
  ride.reliabilityRaw[slot] = Math.min(RELIABILITY_MAX, ride.reliabilityRaw[slot] + gain);
  syncReliabilityPercent(world, slot);
}

function repair(world: World, slot: number): void {
  const ride = world.rides.cols;
  restoreReliabilityAfterRepair(world, slot);
  if (RIDE_CATALOG[ride.typeId[slot] as RideType].usesTrack) releaseHeldTrains(world, slot);
  else if (ride.boarded[slot] > 0) releaseRiders(world, slot);
  ride.breakdownReason[slot] = BreakdownReason.None;
  ride.state[slot] = ride.queueConnected[slot] ? RideState.Open : RideState.Closed;
  ride.phase[slot] = ride.queueConnected[slot] ? RidePhase.Waiting : RidePhase.Closed;
}

function inspect(world: World, slot: number): void {
  const ride = world.rides.cols;
  const percent = Math.min(100, Math.floor(ride.reliabilityRaw[slot] / 256));
  const steps = Math.floor((100 - percent) / INSPECTION_RESTORE_DIVISOR);
  if (steps > 0) {
    const gain = steps * world.rng.int(INSPECTION_RESTORE_BYTE_RANGE);
    ride.reliabilityRaw[slot] = Math.min(RELIABILITY_MAX, ride.reliabilityRaw[slot] + gain);
    syncReliabilityPercent(world, slot);
  }
  ride.lastInspectionTick[slot] = world.tick;
}

/**
 * Finishes a mechanic visit at once: repairs a broken ride, or inspects a working one and
 * restores part of its missing reliability. Refuses while the ride is mid-cycle.
 */
export function inspectRide(world: World, rideId: number, staffId: number): boolean {
  const slot = world.rides.idToSlot[rideId] ?? -1;
  if (slot < 0 || mechanicSlot(world, staffId) < 0 || isActiveCycle(world.rides.cols.phase[slot])) {
    return false;
  }
  completeService(world, slot);
  return true;
}

function completeService(world: World, slot: number): void {
  if (world.rides.cols.phase[slot] === RidePhase.Broken) repair(world, slot);
  else inspect(world, slot);
  world.rides.cols.serviceTicks[slot] = 0;
}

/**
 * Mechanic work at the ride. Each call adds the ticks since the previous one, so staff updating on
 * a stride and a mechanic updated every tick both accumulate real time. A gap longer than
 * `SERVICE_CONTINUITY_TICKS` restarts the work, and two mechanics on the same tick count once.
 * Returns true on the call that completes the repair or inspection.
 */
export function serviceRide(world: World, rideId: number, staffId: number): boolean {
  const slot = world.rides.idToSlot[rideId] ?? -1;
  if (slot < 0 || mechanicSlot(world, staffId) < 0) return false;
  const ride = world.rides.cols;
  if (isActiveCycle(ride.phase[slot])) {
    ride.serviceTicks[slot] = 0;
    return false;
  }
  const elapsed = world.tick - ride.serviceLastTick[slot];
  if (ride.serviceTicks[slot] > 0 && elapsed === 0) return false;
  ride.serviceTicks[slot] =
    ride.serviceTicks[slot] > 0 && elapsed <= SERVICE_CONTINUITY_TICKS
      ? ride.serviceTicks[slot] + elapsed
      : 1;
  ride.serviceLastTick[slot] = world.tick;

  const broken = ride.phase[slot] === RidePhase.Broken;
  const needed = broken
    ? repairTicksFor(ride.breakdownReason[slot] as BreakdownReason)
    : INSPECTION_WORK_TICKS;
  if (ride.serviceTicks[slot] < needed) return false;
  completeService(world, slot);
  return true;
}

export function getRideBreakdownReason(world: World, rideId: number): BreakdownReason {
  const slot = world.rides.idToSlot[rideId] ?? -1;
  return slot < 0
    ? BreakdownReason.None
    : (world.rides.cols.breakdownReason[slot] as BreakdownReason);
}

export function getRideReliabilityRaw(world: World, rideId: number): number {
  const slot = world.rides.idToSlot[rideId] ?? -1;
  return slot < 0 ? 0 : world.rides.cols.reliabilityRaw[slot];
}

/**
 * Tile a mechanic walks to for the ride: the exit path once placed, since a footprint's own tiles
 * are not walkable. A stall has no exit and is served from its own tile.
 */
export function rideServiceX(world: World, slot: number): number {
  const ride = world.rides.cols;
  return ride.exitPlaced[slot] ? ride.exitX[slot] : ride.rideX[slot];
}

export function rideServiceY(world: World, slot: number): number {
  const ride = world.rides.cols;
  return ride.exitPlaced[slot] ? ride.exitY[slot] : ride.rideY[slot];
}

/** Whether the ride's inspection interval has elapsed and nothing else already needs a mechanic. */
export function isRideInspectionDueAt(world: World, slot: number): boolean {
  const ride = world.rides.cols;
  const interval = ride.inspectionIntervalTicks[slot];
  if (
    interval === 0 ||
    isBroken(world, slot) ||
    RIDE_CATALOG[ride.typeId[slot] as RideType]?.breakdowns.length === 0
  ) {
    return false;
  }
  return world.tick - ride.lastInspectionTick[slot] >= interval;
}

/** Minutes of the original inspection clock since the last inspection, capped like its counter. */
export function getRideMinutesSinceInspection(world: World, rideId: number): number {
  const slot = world.rides.idToSlot[rideId] ?? -1;
  if (slot < 0) return 0;
  const minutes = Math.floor(
    (world.tick - world.rides.cols.lastInspectionTick[slot]) / INSPECTION_MINUTE_TICKS,
  );
  return Math.max(0, Math.min(255, minutes));
}

/** Rolling downtime of one ride: a whole percent of its recent checks spent broken down. */
export function getRideDowntimePercent(world: World, rideId: number): number {
  const slot = world.rides.idToSlot[rideId] ?? -1;
  return slot < 0 ? 0 : world.rides.cols.downtimePercent[slot];
}

/** Mean rolling downtime across every ride, shops included; the park rating's uptime input. */
export function getAverageRideDowntimePercent(world: World): number {
  if (world.rides.count === 0) return 0;
  let total = 0;
  for (let slot = 0; slot < world.rides.count; slot++) {
    total += world.rides.cols.downtimePercent[slot];
  }
  return Math.floor(total / world.rides.count);
}

/** Where a ride stands with the maintenance crew. */
export enum MechanicStatus {
  /** No mechanic is needed. */
  None = 0,
  /** The ride is broken down or due an inspection and no mechanic has set out for it. */
  Calling,
  /** A mechanic is walking to the ride. */
  Heading,
  /** A mechanic is at the ride, repairing or inspecting it. */
  Fixing,
}

/** Records that a mechanic is walking to the ride this tick. */
export function markMechanicHeading(world: World, slot: number): void {
  world.rides.cols.mechanicHeadingTick[slot] = world.tick + 1;
}

export function getRideMechanicStatus(world: World, rideId: number): MechanicStatus {
  const slot = world.rides.idToSlot[rideId] ?? -1;
  if (slot < 0) return MechanicStatus.None;
  const ride = world.rides.cols;
  if (!isBroken(world, slot) && !isRideInspectionDueAt(world, slot)) return MechanicStatus.None;
  if (
    ride.serviceTicks[slot] > 0 &&
    world.tick - ride.serviceLastTick[slot] <= SERVICE_CONTINUITY_TICKS
  ) {
    return MechanicStatus.Fixing;
  }
  const heading = ride.mechanicHeadingTick[slot];
  return heading > 0 && world.tick + 1 - heading <= SERVICE_CONTINUITY_TICKS
    ? MechanicStatus.Heading
    : MechanicStatus.Calling;
}
