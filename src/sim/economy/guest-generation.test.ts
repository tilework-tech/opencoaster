import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { layPath, openRide, prepareFlat, row } from '../integration/fixtures';
import { RideState } from '../rides/ride-store';
import { RideType } from '../rides/ride-types';
import { PriceMode } from './ledger';
import {
  campaignGenerationProbability,
  guestGenerationProbability,
  refreshGuestGeneration,
  suggestedGuestMaximum,
  totalRideValueForMoney,
} from './guest-generation';

const open = {
  parkRating: 600,
  guests: 0,
  suggestedGuestMax: 1000,
  entranceFeeCents: 0,
  rideValueForMoney: 0,
  awards: [],
  tick: 0,
};

describe('guest generation probability', () => {
  it('is 50 plus the rating above 200, capped at 650 above it (out of 65536 per tick)', () => {
    const at = (parkRating: number) => guestGenerationProbability({ ...open, parkRating });
    expect(at(0)).toBe(50);
    expect(at(200)).toBe(50);
    expect(at(600)).toBe(450);
    expect(at(850)).toBe(700);
    expect(at(999)).toBe(700);
  });

  it('quarters while the park holds more guests than its suggested maximum', () => {
    const at = (guests: number) =>
      guestGenerationProbability({ ...open, guests, suggestedGuestMax: 100 });
    expect(at(100)).toBe(450);
    expect(at(101)).toBe(112);
  });

  it('quarters for an entrance fee above the ride value, and again above twice it', () => {
    const at = (entranceFeeCents: number) =>
      guestGenerationProbability({ ...open, entranceFeeCents, rideValueForMoney: 800 });
    expect(at(800)).toBe(450);
    expect(at(801)).toBe(112);
    expect(at(1600)).toBe(112);
    expect(at(1602)).toBe(28);
  });

  it('adds or removes a quarter of the probability for each live award', () => {
    const award = (awardId: number, expiresTick = 100) => ({ awardId, expiresTick });
    const at = (awards: ReturnType<typeof award>[]) =>
      guestGenerationProbability({ ...open, awards });
    expect(at([award(0)])).toBe(562);
    expect(at([award(0), award(1)])).toBe(702);
    expect(at([award(13)])).toBe(338);
    expect(at([award(0, 0)])).toBe(450);
  });
});

/** A merry-go-round (slot 0) when `ride` is given, then one stall of each kind in `stalls`. */
function parkWith(ride: RideType | null, ...stalls: RideType[]): Simulation {
  const s = new Simulation({ seed: 9, width: 32, height: 16 });
  prepareFlat(s.world);
  layPath(s.world, row(5, 2, 9));
  layPath(s.world, row(5, 10, 11), true);
  layPath(s.world, row(5, 12, 30));
  layPath(s.world, [[12, 4]]);
  if (ride !== null) {
    openRide(
      s.world,
      ride,
      [11, 4],
      [11, 5],
      [12, 4],
      [
        [10, 5],
        [9, 5],
      ],
    );
  }
  let x = 16;
  for (const stall of stalls) {
    openRide(s.world, stall, [x, 4], [x, 5], [x + 1, 4]);
    x += 3;
  }
  return s;
}

describe('suggested guest maximum', () => {
  it('sums the ride-type bonus of every open ride and stall', () => {
    const s = parkWith(RideType.MerryGoRound, RideType.FoodStall, RideType.Toilets);
    expect(suggestedGuestMaximum(s.world)).toBe(45 + 15 + 5);
  });

  it('ignores closed and broken rides', () => {
    const s = parkWith(RideType.MerryGoRound, RideType.FoodStall);
    s.world.rides.cols.state[0] = RideState.Closed;
    expect(suggestedGuestMaximum(s.world)).toBe(15);
    s.world.rides.cols.state[0] = RideState.Broken;
    expect(suggestedGuestMaximum(s.world)).toBe(15);
  });
});

describe('total ride value for money', () => {
  it('counts twice the value of each open ride and ignores stalls', () => {
    const s = parkWith(RideType.MerryGoRound, RideType.FoodStall);
    const value = totalRideValueForMoney(s.world);
    expect(value).toBeGreaterThan(0);
    expect(value % 2).toBe(0);
    expect(totalRideValueForMoney(parkWith(RideType.MerryGoRound).world)).toBe(value);
    expect(totalRideValueForMoney(parkWith(null, RideType.FoodStall).world)).toBe(0);
  });

  it('subtracts each ride price when guests pay per ride', () => {
    const s = parkWith(RideType.MerryGoRound);
    s.world.rides.cols.excitement[0] = 600;
    s.world.rides.cols.intensity[0] = 300;
    const free = totalRideValueForMoney(s.world);
    s.world.economy.priceMode = PriceMode.PerRide;
    s.world.rides.cols.price[0] = 100;
    expect(totalRideValueForMoney(s.world)).toBe(free - 200);
  });
});

describe('refreshing the generation figures', () => {
  it('derives the probability from the rating, guest count, cap and entrance fee', () => {
    const s = parkWith(RideType.MerryGoRound);
    s.world.economy.parkRating = 600;
    refreshGuestGeneration(s.world);
    const value = totalRideValueForMoney(s.world);
    expect(s.world.economy.guestGeneration).toEqual({
      probability: 450,
      suggestedGuestMax: 45,
      rideValueForMoney: value,
    });
    s.world.economy.priceMode = PriceMode.Admission;
    s.world.economy.admissionPrice = value + 1;
    refreshGuestGeneration(s.world);
    expect(s.world.economy.guestGeneration.probability).toBe(112);
    s.world.economy.admissionPrice = value * 2 + 2;
    refreshGuestGeneration(s.world);
    expect(s.world.economy.guestGeneration.probability).toBe(28);
  });
});

describe('campaign guest generation', () => {
  const run = (campaignId: number, patch: (s: Simulation) => void = () => {}) => {
    const s = parkWith(RideType.MerryGoRound);
    s.world.economy.campaignId = campaignId;
    s.world.economy.campaignWeeksLeft = 2;
    s.world.economy.campaignTarget = s.world.rides.slotToId[0];
    patch(s);
    return campaignGenerationProbability(s.world);
  };
  const admission = (price: number) => (s: Simulation) => {
    s.world.economy.priceMode = PriceMode.Admission;
    s.world.economy.admissionPrice = price;
  };

  it('is zero without a running campaign', () => {
    const s = parkWith(null);
    expect(campaignGenerationProbability(s.world)).toBe(0);
  });

  it('draws extra guests at each campaign type’s own per-tick chance', () => {
    expect(run(0, admission(400))).toBe(400);
    expect(run(2, (s) => (s.world.rides.cols.price[0] = 30))).toBe(300);
    expect(run(3, admission(600))).toBe(200);
    expect(run(4)).toBe(200);
    expect(run(1)).toBe(250);
    expect(run(5)).toBe(200);
  });

  it('draws an eighth as many when the fee or ride price is already low', () => {
    expect(run(0, admission(399))).toBe(50);
    expect(run(3, admission(599))).toBe(25);
    expect(run(2, (s) => (s.world.rides.cols.price[0] = 29))).toBe(37);
  });
});
