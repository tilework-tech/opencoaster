import type { System } from '../core/system';
import type { World } from '../core/world';
import { GuestState } from '../guests/guest-store';
import { getRideValueCents, isShopCategory } from '../rides/ride-operations';
import { RideState } from '../rides/ride-store';
import { RIDE_CATALOG, type RideType } from '../rides/ride-types';
import { calculateStaffWageBill } from '../staff/staff-store';
import { setEconomyInputs } from './api';
import {
  HAPPY_ABOVE,
  LITTER_COUNTS_AFTER_TICKS,
  RATING_UNIT_DIVISOR,
  rideValueContribution,
} from './park-rating';
import { ridersInRecentWindow } from '../rides/ride-store';
import type { ParkValueRide } from './ledger';

/** Inputs are republished this often; a divisor of the rating refresh cadence. */
export const INPUT_REFRESH_TICKS = 128;
/** Fortnightly running cost of an open ride, as a fraction (1/N) of its build cost. Tunable. */
export const RIDE_UPKEEP_DIVISOR = 50;
const SHOP_UPKEEP_DIVISOR = 100;

/**
 * Publishes what rides, stalls and guests currently contribute to the economy: upkeep,
 * upkeep, ride value and the park-rating inputs. Runs ahead of the economy system so the
 * weekly, fortnightly and rating-refresh boundaries read fresh figures.
 */
export const parkInputsSystem: System = {
  name: 'park-inputs',
  update(world: World) {
    if (world.tick % INPUT_REFRESH_TICKS !== 0) return;
    const ride = world.rides.cols;
    let upkeep = 0;
    const valueRides: ParkValueRide[] = [];
    let qualifying = 0;
    let excitement = 0;
    let intensity = 0;
    let downRides = 0;
    let rideCount = 0;
    let rated = 0;
    let ratedExcitement = 0;
    let ratedIntensity = 0;
    for (let slot = 0; slot < world.rides.count; slot++) {
      const definition = RIDE_CATALOG[ride.typeId[slot] as RideType];
      if (!definition) continue;
      const shop = isShopCategory(definition.category);
      rideCount++;
      if (ride.state[slot] === RideState.Broken) downRides++;
      if (!shop && ride.tested[slot] !== 0) {
        rated++;
        ratedExcitement += Math.trunc(ride.excitement[slot] / RATING_UNIT_DIVISOR);
        ratedIntensity += Math.trunc(ride.intensity[slot] / RATING_UNIT_DIVISOR);
      }
      if (!shop) {
        const typeBonus = Math.max(
          1,
          Math.floor(definition.valueWeights.reduce((sum, weight) => sum + weight, 0) / 10),
        );
        valueRides.push({
          valueCents: getRideValueCents(world, world.rides.slotToId[slot]),
          ridersLast5Minutes: ridersInRecentWindow(world, slot),
          typeBonus,
        });
      }
      if (ride.state[slot] !== RideState.Open) continue;
      upkeep +=
        definition.runningCostPerFortnightCents ??
        Math.floor(definition.cost / (shop ? SHOP_UPKEEP_DIVISOR : RIDE_UPKEEP_DIVISOR));
      if (!shop) {
        qualifying++;
        excitement += ride.excitement[slot];
        intensity += ride.intensity[slot];
      }
    }

    let oldLitter = 0;
    for (let slot = 0; slot < world.litter.count; slot++) {
      if (world.litter.cols.age[slot] >= LITTER_COUNTS_AFTER_TICKS) oldLitter++;
    }

    const guests = world.guests.cols;
    let happy = 0;
    let lost = 0;
    const map = world.map;
    for (let slot = 0; slot < world.guests.count; slot++) {
      if (guests.happiness[slot] > HAPPY_ABOVE) happy++;
      if (guests.state[slot] === GuestState.Riding) continue;
      if (guests.lostTicks[slot] > 0) {
        lost++;
        continue;
      }
      if (!map.isWalkable(map.index(guests.x[slot] >> 8, guests.y[slot] >> 8))) lost++;
    }

    setEconomyInputs(world, {
      wageBillPerWeek: calculateStaffWageBill(world),
      rideUpkeepPerFortnight: upkeep,
      rideValue: rideValueContribution(valueRides),
      qualifyingRideCount: qualifying,
      openAttractionCount: qualifying,
      excitementTotal: excitement,
      intensityTotal: intensity,
      lostGuests: lost,
      happyGuests: happy,
      unhappyPercent:
        world.guests.count === 0
          ? 0
          : Math.floor(((world.guests.count - happy) * 100) / world.guests.count),
      rideCount,
      ratedRideCount: rated,
      ratedExcitementEighths: ratedExcitement,
      ratedIntensityEighths: ratedIntensity,
      rideDowntimePercent: rideCount === 0 ? 0 : Math.floor((downRides * 100) / rideCount),
      litter: oldLitter,
    });
  },
};
