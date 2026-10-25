import { describe, expect, it } from 'vitest';
import { EconomyResult } from '../../sim/economy/actions';
import { RideType } from '../../sim/rides/ride-types';
import { RideInfo, RIDE_INFO_STRIDE } from '../../worker/snapshot';
import {
  economyFeedbackMessage,
  isFoodOrDrinkStall,
  isPromotableRide,
  targetOptions,
} from './campaign-targets';

function park(rides: Array<{ id: number; type: RideType }>) {
  const rideInfo = new Int32Array(RIDE_INFO_STRIDE * rides.length);
  rides.forEach((ride, i) => {
    rideInfo[i * RIDE_INFO_STRIDE + RideInfo.Id] = ride.id;
    rideInfo[i * RIDE_INFO_STRIDE + RideInfo.Type] = ride.type;
  });
  return { rides: { count: rides.length }, rideInfo };
}

describe('campaign target choices', () => {
  const snapshot = park([
    { id: 3, type: RideType.MerryGoRound },
    { id: 5, type: RideType.FoodStall },
    { id: 6, type: RideType.DrinkStall },
    { id: 8, type: RideType.InformationKiosk },
  ]);

  it('offers rides but not shops or facilities for ride campaigns', () => {
    expect(targetOptions(snapshot, isPromotableRide)).toEqual([
      { id: 3, name: 'Merry-Go-Round #3' },
    ]);
  });

  it('offers only food and drink stalls for item campaigns', () => {
    expect(targetOptions(snapshot, isFoodOrDrinkStall).map((option) => option.id)).toEqual([5, 6]);
  });

  it('offers nothing for an empty park', () => {
    expect(targetOptions(park([]), isPromotableRide)).toEqual([]);
  });
});

describe('economy feedback', () => {
  it('explains every rejection in player terms', () => {
    const codes = [
      EconomyResult.Ok,
      EconomyResult.Rejected,
      EconomyResult.BadCampaign,
      EconomyResult.BadDuration,
      EconomyResult.MissingTarget,
      EconomyResult.NoSuchRide,
      EconomyResult.NotARide,
      EconomyResult.NotAFoodOrDrinkStall,
    ];
    for (const code of codes) {
      const text = economyFeedbackMessage(code);
      if (code === EconomyResult.Ok) expect(text).toBe('');
      else expect(text, `code ${code}`).not.toBe('');
    }
  });

  it('names the missing target for a campaign with no ride or stall', () => {
    expect(economyFeedbackMessage(EconomyResult.MissingTarget)).toMatch(/ride or stall/);
  });
});
