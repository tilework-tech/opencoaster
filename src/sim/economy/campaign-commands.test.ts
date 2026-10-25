import { describe, expect, it } from 'vitest';
import { flatWorld } from '../integration/fixtures';
import { createRide } from '../rides/ride-operations';
import { RideType } from '../rides/ride-types';
import { Simulation } from '../core/simulation';
import { FeedbackDomain } from '../core/feedback';
import { applyEconomyCommand, EconomyResult } from './actions';
import { NO_TARGET } from './ledger';
import { CAMPAIGNS } from './marketing';

const PARK_WIDE = 0;
const PARK_ADVERTISING = 1;
const FREE_RIDE = 2;
const FOOD_OFFER = 4;
const RIDE_ADVERTISING = 5;

describe('campaign commands with targets', () => {
  it('starts a park-wide campaign without a target', () => {
    const world = flatWorld(16, 3);
    expect(
      applyEconomyCommand(world, {
        type: 'startCampaign',
        campaignId: PARK_ADVERTISING,
        weeks: 2,
      }),
    ).toBe(EconomyResult.Ok);
    expect(world.economy.campaignId).toBe(PARK_ADVERTISING);
    expect(world.economy.campaignTarget).toBe(NO_TARGET);
  });

  it('refuses a ride voucher without a ride target and leaves the campaign untouched', () => {
    const world = flatWorld(16, 3);
    expect(
      applyEconomyCommand(world, { type: 'startCampaign', campaignId: FREE_RIDE, weeks: 4 }),
    ).toBe(EconomyResult.MissingTarget);
    expect(world.economy.campaignWeeksLeft).toBe(0);
  });

  it('starts a free ride voucher on an existing ride and stores its id', () => {
    const world = flatWorld(16, 3);
    const rideId = createRide(world, RideType.MerryGoRound, 4, 4);
    expect(
      applyEconomyCommand(world, {
        type: 'startCampaign',
        campaignId: FREE_RIDE,
        weeks: 4,
        targetId: rideId,
      }),
    ).toBe(EconomyResult.Ok);
    expect(world.economy.campaignTarget).toBe(rideId);
    expect(world.economy.campaignWeeksLeft).toBe(4);
  });

  it('refuses a ride target that does not exist', () => {
    const world = flatWorld(16, 3);
    expect(
      applyEconomyCommand(world, {
        type: 'startCampaign',
        campaignId: RIDE_ADVERTISING,
        weeks: 2,
        targetId: 42,
      }),
    ).toBe(EconomyResult.NoSuchRide);
    expect(world.economy.campaignWeeksLeft).toBe(0);
  });

  it('accepts any food or drink stall as the target of a food offer', () => {
    const world = flatWorld(16, 3);
    const burgerId = createRide(world, RideType.BurgerStall, 4, 4);
    expect(
      applyEconomyCommand(world, {
        type: 'startCampaign',
        campaignId: FOOD_OFFER,
        weeks: 2,
        targetId: burgerId,
      }),
    ).toBe(EconomyResult.Ok);
    expect(world.economy.campaignTarget).toBe(burgerId);
  });

  it('refuses an information kiosk as the target of a food offer', () => {
    const world = flatWorld(16, 3);
    const kioskId = createRide(world, RideType.InformationKiosk, 4, 4);
    expect(
      applyEconomyCommand(world, {
        type: 'startCampaign',
        campaignId: FOOD_OFFER,
        weeks: 2,
        targetId: kioskId,
      }),
    ).toBe(EconomyResult.NotAFoodOrDrinkStall);
    expect(world.economy.campaignWeeksLeft).toBe(0);
  });

  it('refuses a stall as the ride target of a ride campaign', () => {
    const world = flatWorld(16, 3);
    const stallId = createRide(world, RideType.FoodStall, 4, 4);
    expect(
      applyEconomyCommand(world, {
        type: 'startCampaign',
        campaignId: RIDE_ADVERTISING,
        weeks: 2,
        targetId: stallId,
      }),
    ).toBe(EconomyResult.NotARide);
  });

  it('requires a food or drink stall as the item target of a food offer', () => {
    const world = flatWorld(16, 3);
    const rideId = createRide(world, RideType.MerryGoRound, 4, 4);
    const stallId = createRide(world, RideType.DrinkStall, 8, 8);
    expect(
      applyEconomyCommand(world, {
        type: 'startCampaign',
        campaignId: FOOD_OFFER,
        weeks: 3,
        targetId: rideId,
      }),
    ).toBe(EconomyResult.NotAFoodOrDrinkStall);
    expect(
      applyEconomyCommand(world, {
        type: 'startCampaign',
        campaignId: FOOD_OFFER,
        weeks: 3,
        targetId: stallId,
      }),
    ).toBe(EconomyResult.Ok);
    expect(world.economy.campaignTarget).toBe(stallId);
  });

  it('rejects durations outside one to six weeks and unknown campaigns', () => {
    const world = flatWorld(16, 3);
    expect(
      applyEconomyCommand(world, { type: 'startCampaign', campaignId: PARK_WIDE, weeks: 0 }),
    ).toBe(EconomyResult.BadDuration);
    expect(
      applyEconomyCommand(world, { type: 'startCampaign', campaignId: PARK_WIDE, weeks: 7 }),
    ).toBe(EconomyResult.BadDuration);
    expect(
      applyEconomyCommand(world, {
        type: 'startCampaign',
        campaignId: CAMPAIGNS.length,
        weeks: 1,
      }),
    ).toBe(EconomyResult.BadCampaign);
  });

  it('reports rejected loans as a rejection', () => {
    const world = flatWorld(16, 3);
    expect(applyEconomyCommand(world, { type: 'repay', cents: 1 })).toBe(EconomyResult.Rejected);
  });
});

describe('campaign commands through the simulation', () => {
  it('reports the outcome of the latest economy command to the UI', () => {
    const s = new Simulation({ seed: 4, width: 16, height: 16 });
    s.enqueue({
      type: 'economy',
      action: { type: 'startCampaign', campaignId: FREE_RIDE, weeks: 4 },
    });
    s.step();
    expect(s.world.feedback.domain).toBe(FeedbackDomain.Economy);
    expect(s.world.feedback.code).toBe(EconomyResult.MissingTarget);
    expect(s.world.economy.campaignWeeksLeft).toBe(0);
  });
});
