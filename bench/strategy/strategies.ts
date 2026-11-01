import type { StrategyFactory } from './run';
import { growthStrategy } from './growth';
import { sitePlanStrategy } from './site-plan';
import type { SiteStep } from './site-plan';
import thunderheadPlan from './plans/thunderhead-mesa.json';
import tidewaterPlan from './plans/tidewater-docks.json';
import mossgrovePlan from './plans/mossgrove-isle.json';

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

STRATEGIES['copper-ridge'] = growthStrategy({
  ...BASE,
  reserveCents: 150_000,
  prices: RIDE_PRICES,
  jitter: { skipPercent: 15, startDelayMonths: 1 },
  opening: list('foodStall drinkStall toilets merryGoRound'),
  growth: [
    'coaster:compact:1',
    ...list('ferrisWheel drinkStall'),
    'coaster:compact:-1',
    ...list('foodStall swingingShip'),
    'coaster:riverRun:1',
    ...list('twist toilets'),
    'coaster:riverRun:-1',
    ...list('merryGoRound informationKiosk'),
    'coaster:compact:1',
  ],
});

STRATEGIES['tidewater-docks'] = sitePlanStrategy({
  steps: tidewaterPlan as SiteStep[],
  reserveCents: 400_000,
  patrols: [
    [8, 38, 24, 56],
    [8, 52, 24, 64],
    [16, 56, 64, 64],
    [30, 38, 50, 62],
  ],
  prices: RIDE_PRICES,
  itemsPerHandyman: 1.5,
  attractionsPerMechanic: 3,
  repayAboveCents: 150_000,
});

STRATEGIES['thunderhead-mesa'] = sitePlanStrategy({
  steps: thunderheadPlan as SiteStep[],
  reserveCents: 200_000,
  patrols: [
    [30, 8, 62, 28],
    [30, 8, 62, 28],
    [8, 46, 40, 64],
    [30, 8, 62, 28],
    [18, 22, 38, 52],
    [58, 50, 84, 64],
    [56, 26, 74, 52],
  ],
  prices: RIDE_PRICES,
  itemsPerHandyman: 2,
  attractionsPerMechanic: 3,
});

STRATEGIES['glacier-point'] = growthStrategy({
  ...BASE,
  reserveCents: 150_000,
  prices: RIDE_PRICES,
  jitter: { skipPercent: 20, startDelayMonths: 3 },
  opening: list('foodStall drinkStall toilets merryGoRound'),
  growth: [
    'coaster:riverRun:1',
    ...list('ferrisWheel drinkStall'),
    'coaster:switchback:-1',
    ...list('foodStall twist'),
    'coaster:riverRun:1',
    ...list('toilets swingingShip'),
    'coaster:switchback:-1',
    ...list('merryGoRound informationKiosk'),
    'coaster:riverRun:1',
    'coaster:switchback:-1',
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
