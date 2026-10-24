import type { System } from '../core/system';
import type { World } from '../core/world';
import { GuestState } from '../guests/guest-store';
import { getRideValueCents, isShopCategory } from '../rides/ride-operations';
import { RideState } from '../rides/ride-store';
import { RIDE_CATALOG, type RideType } from '../rides/ride-types';
import { calculateStaffWageBill } from '../staff/staff-store';
import { setEconomyInputs } from './api';

/** Inputs are republished this often; a divisor of the rating refresh cadence. */
export const INPUT_REFRESH_TICKS = 128;
/** Fortnightly running cost of an open ride, as a fraction (1/N) of its build cost. Tunable. */
export const RIDE_UPKEEP_DIVISOR = 50;
const SHOP_UPKEEP_DIVISOR = 100;
/** Guests below this happiness count as unhappy for the park rating. */
const UNHAPPY_BELOW = 128;

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
    let value = 0;
    let qualifying = 0;
    let attractions = 0;
    let excitement = 0;
    let intensity = 0;
    let broken = 0;
    for (let slot = 0; slot < world.rides.count; slot++) {
      const definition = RIDE_CATALOG[ride.typeId[slot] as RideType];
      if (!definition) continue;
      const shop = isShopCategory(definition.category);
      if (!shop) {
        attractions++;
        if (ride.state[slot] === RideState.Broken) broken++;
      }
      if (ride.state[slot] !== RideState.Open) continue;
      upkeep += Math.floor(definition.cost / (shop ? SHOP_UPKEEP_DIVISOR : RIDE_UPKEEP_DIVISOR));
      if (!shop) {
        qualifying++;
        excitement += ride.excitement[slot];
        intensity += ride.intensity[slot];
        value += getRideValueCents(world, world.rides.slotToId[slot]);
      }
    }

    const guests = world.guests.cols;
    let unhappy = 0;
    let lost = 0;
    const map = world.map;
    for (let slot = 0; slot < world.guests.count; slot++) {
      if (guests.happiness[slot] < UNHAPPY_BELOW) unhappy++;
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
      rideValue: value,
      qualifyingRideCount: qualifying,
      openAttractionCount: qualifying,
      excitementTotal: excitement,
      intensityTotal: intensity,
      lostGuests: lost,
      unhappyPercent:
        world.guests.count === 0 ? 0 : Math.floor((unhappy * 100) / world.guests.count),
      rideDowntimePercent: attractions === 0 ? 0 : Math.floor((broken * 100) / attractions),
      litter: world.litter.count,
    });
  },
};
