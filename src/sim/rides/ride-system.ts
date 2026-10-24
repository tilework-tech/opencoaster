import type { System } from '../core/system';
import { RidePhase, RideState } from './ride-store';
import { updateRideAge } from './ride-operations';
import { RIDE_CATALOG } from './ride-types';
import type { RideType } from './ride-types';

const RELIABILITY_WEAR_CYCLES = 32;
const BREAKDOWN_RELIABILITY_THRESHOLD = 10;

/**
 * Books one finished trip carrying `riders` guests: counts it, wears reliability and may cause a
 * breakdown. Several trips can be out at once on a multi-train coaster.
 */
export function completeCycle(
  world: Parameters<System['update']>[0],
  slot: number,
  riders: number,
): void {
  const ride = world.rides.cols;
  ride.cyclesCompleted[slot]++;
  if (ride.cyclesCompleted[slot] % RELIABILITY_WEAR_CYCLES === 0 && ride.reliability[slot] > 0) {
    ride.reliability[slot]--;
  }
  ride.guestsServed[slot] += riders;
  ride.boarded[slot] = Math.max(0, ride.boarded[slot] - riders);
  if (
    ride.state[slot] === RideState.Open &&
    ride.reliability[slot] <= BREAKDOWN_RELIABILITY_THRESHOLD &&
    world.rng.int(100) < (BREAKDOWN_RELIABILITY_THRESHOLD - ride.reliability[slot] + 1) * 2
  ) {
    ride.state[slot] = RideState.Broken;
    ride.phase[slot] = RidePhase.Broken;
    ride.breakdownCounter[slot]++;
  }
}

/** Ends a ride cycle: counts served guests, wears reliability and may cause a breakdown. */
export function finishCycle(world: Parameters<System['update']>[0], slot: number): void {
  const ride = world.rides.cols;
  completeCycle(world, slot, ride.boarded[slot]);
  ride.waitTicks[slot] = 0;
  ride.phaseTicks[slot] = 0;
  ride.boarded[slot] = 0;
  if (ride.state[slot] === RideState.Broken) {
    ride.phase[slot] = RidePhase.Broken;
  } else if (ride.state[slot] === RideState.Open) {
    ride.phase[slot] = RidePhase.Waiting;
  } else {
    ride.phase[slot] = RidePhase.Closed;
  }
}

export const rideSystem: System = {
  name: 'rides',
  update(world) {
    updateRideAge(world);
    const ride = world.rides.cols;
    for (let slot = 0; slot < world.rides.count; slot++) {
      if (ride.phase[slot] === RidePhase.Broken) {
        if (ride.downtimeTicks[slot] < 0xffffffff) ride.downtimeTicks[slot]++;
        continue;
      }
      if (RIDE_CATALOG[ride.typeId[slot] as RideType]?.usesTrack) continue;

      if (ride.phase[slot] === RidePhase.Loading) {
        if (ride.phaseTicks[slot] > 1) {
          ride.phaseTicks[slot]--;
        } else {
          ride.phase[slot] = RidePhase.Running;
          ride.phaseTicks[slot] = ride.runTicks[slot];
        }
        continue;
      }

      if (ride.phase[slot] === RidePhase.Running) {
        if (ride.phaseTicks[slot] > 1) {
          ride.phaseTicks[slot]--;
        } else if (ride.unloadTicks[slot] > 0) {
          ride.phase[slot] = RidePhase.Unloading;
          ride.phaseTicks[slot] = ride.unloadTicks[slot];
        } else {
          finishCycle(world, slot);
        }
        continue;
      }

      if (ride.phase[slot] === RidePhase.Unloading) {
        if (ride.phaseTicks[slot] > 1) {
          ride.phaseTicks[slot]--;
        } else {
          finishCycle(world, slot);
        }
        continue;
      }

      if (ride.state[slot] !== RideState.Open || ride.phase[slot] !== RidePhase.Waiting) continue;
      if (ride.queueLength[slot] === 0) {
        ride.waitTicks[slot] = 0;
        continue;
      }
      if (ride.waitTicks[slot] < 0xffff) ride.waitTicks[slot]++;
      if (ride.waitTicks[slot] < ride.minWaitTicks[slot]) continue;

      const loadReached =
        ride.queueLength[slot] * 255 >= ride.capacity[slot] * ride.loadThreshold[slot];
      const maxWaitReached = ride.waitTicks[slot] >= ride.maxWaitTicks[slot];
      if (!loadReached && !maxWaitReached) continue;

      const boarded = Math.min(ride.capacity[slot], ride.queueLength[slot]);
      if (boarded === 0) continue;
      ride.boarded[slot] = boarded;
      ride.queueLength[slot] -= boarded;
      if (ride.loadTicks[slot] > 0) {
        ride.phase[slot] = RidePhase.Loading;
        ride.phaseTicks[slot] = ride.loadTicks[slot];
      } else {
        ride.phase[slot] = RidePhase.Running;
        ride.phaseTicks[slot] = ride.runTicks[slot];
      }
    }
  },
};
