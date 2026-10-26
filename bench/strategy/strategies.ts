import type { StrategyFactory } from './run';
import { growthStrategy } from './growth';

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

STRATEGIES['tidewater-docks'] = growthStrategy({
  ...BASE,
  itemsPerHandyman: 1.5,
  reserveCents: 600_000,
  prices: RIDE_PRICES,
  jitter: { skipPercent: 15, startDelayMonths: 2 },
  opening: OPENING,
  growth: LONG_GROWTH.slice(0, 18),
  extra: (b) => {
    const l = b.sim.world.economy;
    if (l.loan > 0 && l.cash > l.loan + 150_000) b.repay(l.loan);
  },
});

STRATEGIES['thunderhead-mesa'] = growthStrategy({
  ...BASE,
  itemsPerHandyman: 1.5,
  prices: RIDE_PRICES,
  jitter: { skipPercent: 25, startDelayMonths: 3 },
  opening: OPENING,
  growth: LONG_GROWTH.slice(0, 16),
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
