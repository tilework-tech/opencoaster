import type { World } from '../core/world';
import { WeatherKind } from '../weather/weather';
import { StaffKind } from '../staff/staff-store';
import { breakDownRide, holdRideTrains, releaseHeldTrains } from './coaster';
import { BreakdownReason, holdsRidersAboard, repairTicksFor } from './breakdown-reasons';
import type { BreakdownWeight } from './breakdown-reasons';
import { RidePhase, RideState } from './ride-store';
import { RIDE_CATALOG } from './ride-types';
import type { RideType } from './ride-types';

/** Full reliability (100%) and the top of the scale, which keeps the byte below the percent. */
export const RELIABILITY_FULL = 100 * 256;
export const RELIABILITY_MAX = 25_855;
/** Reliability wears and breakdowns are rolled once per this many global ticks. */
export const RELIABILITY_CHECK_TICKS = 256;

/** A breakdown succeeds for `BREAKDOWN_ROLL_BASE - reliability` values of `BREAKDOWN_ROLL_RANGE`. */
const BREAKDOWN_ROLL_RANGE = 3_145_728;
const BREAKDOWN_ROLL_BASE = 25_857;

const MONTHS_PER_YEAR = 8;
/**
 * Percentage of a ride's base wear applied in each year of its life; the last entry holds for
 * every later year. The source says older rides wear faster without giving the schedule, so the
 * steps are OpenCoaster tuning (docs/DECISIONS.md).
 */
const AGE_WEAR_PERCENT_BY_YEAR: readonly number[] = [100, 100, 125, 150, 200, 250, 300, 400];

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

function ageWearPercent(ageMonths: number): number {
  const year = Math.floor(ageMonths / MONTHS_PER_YEAR);
  return AGE_WEAR_PERCENT_BY_YEAR[Math.min(year, AGE_WEAR_PERCENT_BY_YEAR.length - 1)];
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

function pickReason(world: World, slot: number): BreakdownReason {
  const weights = breakdownReasonWeights(
    world.rides.cols.typeId[slot] as RideType,
    world.weather.kind,
  );
  let total = 0;
  for (const entry of weights) total += entry.weight;
  let roll = world.rng.int(total);
  for (const entry of weights) {
    if (roll < entry.weight) return entry.reason;
    roll -= entry.weight;
  }
  return weights[weights.length - 1].reason;
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

/**
 * Once per check interval every ride that can break down loses reliability, older rides faster,
 * and an open one rolls for a failure. Zero reliability always fails.
 */
export function updateRideMaintenance(world: World): void {
  if (world.tick % RELIABILITY_CHECK_TICKS !== 0) return;
  const ride = world.rides.cols;
  for (let slot = 0; slot < world.rides.count; slot++) {
    const def = RIDE_CATALOG[ride.typeId[slot] as RideType];
    if (!def || def.breakdowns.length === 0 || ride.state[slot] === RideState.Broken) continue;

    const wear = Math.floor((def.unreliability * ageWearPercent(ride.ageMonths[slot])) / 100);
    ride.reliabilityRaw[slot] = Math.max(0, ride.reliabilityRaw[slot] - wear);
    syncReliabilityPercent(world, slot);

    if (ride.state[slot] !== RideState.Open) continue;
    const reliability = ride.reliabilityRaw[slot];
    if (
      reliability === 0 ||
      world.rng.int(BREAKDOWN_ROLL_RANGE) < BREAKDOWN_ROLL_BASE - reliability
    ) {
      breakRide(world, slot, pickReason(world, slot));
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

function repair(world: World, slot: number): void {
  const ride = world.rides.cols;
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
