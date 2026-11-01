import type { StrategyFactory } from './run';
import { growthStrategy } from './growth';
import { SceneryItem } from '../../src/sim/map/scenery';
import { sitePlanStrategy } from './site-plan';
import { Funding } from '../../src/sim/research/research';
import type { SiteStep } from './site-plan';
import thunderheadPlan from './plans/thunderhead-mesa.json';
import tidewaterPlan from './plans/tidewater-docks.json';
import mossgrovePlan from './plans/mossgrove-isle.json';
import glacierPlan from './plans/glacier-point.json';
import copperPlan from './plans/copper-ridge.json';

/** Build orders are written as space-separated names. */
const list = (names: string): string[] => names.split(/\s+/).filter(Boolean);

const OPENING = list('foodStall drinkStall toilets ferrisWheel');

/** Every flat ride and stall the standard apron has room for, in the order a keen player adds them. */
const LONG_GROWTH = list(`
  drinkStall twist foodStall merryGoRound toilets informationKiosk swingingShip ferrisWheel
  drinkStall foodStall twist swingingShip toilets merryGoRound ferrisWheel foodStall drinkStall
  twist swingingShip toilets merryGoRound ferrisWheel foodStall drinkStall
`);

/** Per-ride ticket prices (cents) that guests accept in most parks. */
const RIDE_PRICES = {
  merryGoRound: 100,
  ferrisWheel: 150,
  swingingShip: 150,
  twist: 150,
  coaster: 250,
};

/** Scripted playthrough per scenario id. Each is tuned so its scenario is winnable, not trivial. */
export const STRATEGIES: Record<string, StrategyFactory> = {
  'lantern-bay': growthStrategy({
    prices: RIDE_PRICES,
    opening: OPENING,
    growth: LONG_GROWTH,
    reserveCents: 500_000,
    itemsPerHandyman: 1,
    attractionsPerMechanic: 3,
  }),
  meadowbrook: growthStrategy({
    opening: OPENING,
    growth: LONG_GROWTH.slice(0, 10),
    reserveCents: 500_000,
    itemsPerHandyman: 2,
    attractionsPerMechanic: 3,
  }),
};

const BASE = { reserveCents: 500_000, itemsPerHandyman: 1, attractionsPerMechanic: 3 };

STRATEGIES['bramblewood-hollow'] = growthStrategy({
  ...BASE,
  prices: RIDE_PRICES,
  opening: OPENING,
  growth: LONG_GROWTH.slice(0, 14),
});

STRATEGIES['mossgrove-isle'] = sitePlanStrategy({
  steps: mossgrovePlan as SiteStep[],
  reserveCents: 300_000,
  patrols: [
    [28, 34, 44, 50],
    [16, 18, 36, 40],
    [36, 18, 54, 40],
  ],
  prices: RIDE_PRICES,
  itemsPerHandyman: 1,
  attractionsPerMechanic: 3,
});

STRATEGIES['copper-ridge'] = sitePlanStrategy({
  steps: copperPlan as SiteStep[],
  reserveCents: 150_000,
  prices: RIDE_PRICES,
  itemsPerHandyman: 2,
  attractionsPerMechanic: 2,
  borrow: true,
  decorate: { item: SceneryItem.Conifer, count: 30 },
  patrols: [
    [26, 72, 66, 88],
    [14, 34, 46, 50],
    [30, 44, 62, 76],
  ],
});

/**
 * Tidewater Docks: rides with real queues on the west quay, a bin on every footpath, the loan
 * repaid as soon as the cash covers it, then (from month 20, so the new rides are still young at
 * the deadline) a south-quay walk out to both finger piers lined with ships, wheels and stalls.
 * Nothing needed is left to research, so research funding is switched off.
 */
STRATEGIES['tidewater-docks'] = sitePlanStrategy({
  steps: tidewaterPlan as SiteStep[],
  reserveCents: 300_000,
  researchFunding: Funding.None,
  patrols: [
    [8, 38, 15, 46],
    [8, 47, 15, 55],
    [16, 38, 23, 46],
    [16, 47, 23, 55],
    [8, 56, 23, 63],
    [30, 38, 38, 57],
    [41, 40, 49, 57],
    [22, 54, 56, 62],
    [8, 30, 23, 37],
    [30, 38, 38, 57],
    [41, 40, 49, 57],
    [22, 54, 56, 62],
  ],
  prices: RIDE_PRICES,
  itemsPerHandyman: 1.5,
  attractionsPerMechanic: 4,
});

/**
 * Thunderhead Mesa: the cliff trail first, then rides with real queues on the mesa top by the
 * gate, then the west shelf below the trail, with bins along the trail and on every footpath.
 * Handymen patrol the trail and the shelf; the rest roam the mesa. Research funding is off.
 */
STRATEGIES['thunderhead-mesa'] = sitePlanStrategy({
  steps: thunderheadPlan as SiteStep[],
  reserveCents: 200_000,
  researchFunding: Funding.None,
  patrols: [
    null,
    [24, 24, 35, 47],
    [10, 49, 36, 64],
    null,
    [10, 49, 36, 64],
    null,
    [38, 9, 56, 24],
    [24, 24, 35, 47],
    [10, 49, 36, 64],
    null,
  ],
  prices: RIDE_PRICES,
  itemsPerHandyman: 1.5,
  attractionsPerMechanic: 4,
});

STRATEGIES['glacier-point'] = sitePlanStrategy({
  steps: glacierPlan as SiteStep[],
  reserveCents: 150_000,
  prices: RIDE_PRICES,
  itemsPerHandyman: 2,
  attractionsPerMechanic: 2,
  borrow: true,
  decorate: { item: SceneryItem.Conifer, count: 30 },
  patrols: [
    [70, 42, 92, 60],
    [50, 42, 74, 60],
    [54, 56, 82, 78],
  ],
});

STRATEGIES['seaside-promenade'] = growthStrategy({
  ...BASE,
  opening: list('foodStall drinkStall foodStall drinkStall toilets ferrisWheel'),
  growth: list(
    'foodStall drinkStall merryGoRound foodStall drinkStall twist toilets foodStall drinkStall swingingShip foodStall drinkStall',
  ),
});

STRATEGIES['riverside-fairground'] = growthStrategy({
  ...BASE,
  jitter: { skipPercent: 15, startDelayMonths: 2 },
  opening: OPENING,
  growth: LONG_GROWTH,
});

STRATEGIES['open-grounds'] = growthStrategy({
  ...BASE,
  prices: RIDE_PRICES,
  opening: OPENING,
  growth: LONG_GROWTH.slice(0, 20),
});
