import { TICKS_PER_YEAR } from '../economy/calendar';
import { LedgerCategory, PriceMode } from '../economy/ledger';
import { ObjectiveKind } from './scenario';
import type { EntranceSide, ScenarioDef, ScenarioEntrance } from './scenario';

type Json = Record<string, unknown>;

const OBJECTIVE_KINDS: Record<string, ObjectiveKind> = {
  guests: ObjectiveKind.Guests,
  parkValue: ObjectiveKind.ParkValue,
  guestsAndRating: ObjectiveKind.GuestsAndRating,
  repayLoanAndParkValue: ObjectiveKind.RepayLoanAndParkValue,
  monthlyIncome: ObjectiveKind.MonthlyIncome,
  qualifyingRides: ObjectiveKind.QualifyingRides,
};

const PRICE_MODES: Record<string, PriceMode> = {
  free: PriceMode.Free,
  admission: PriceMode.Admission,
  perRide: PriceMode.PerRide,
};

const LEDGER_CATEGORIES: Record<string, LedgerCategory> = {
  rideConstruction: LedgerCategory.RideConstruction,
  rideRunning: LedgerCategory.RideRunning,
  land: LedgerCategory.Land,
  landscaping: LedgerCategory.Landscaping,
  admission: LedgerCategory.Admission,
  rideTickets: LedgerCategory.RideTickets,
  shopSales: LedgerCategory.ShopSales,
  shopStock: LedgerCategory.ShopStock,
  foodDrinkSales: LedgerCategory.FoodDrinkSales,
  foodDrinkStock: LedgerCategory.FoodDrinkStock,
  wages: LedgerCategory.Wages,
  marketing: LedgerCategory.Marketing,
  research: LedgerCategory.Research,
  interest: LedgerCategory.Interest,
};

const SIDES: Record<EntranceSide, EntranceSide> = {
  north: 'north',
  east: 'east',
  south: 'south',
  west: 'west',
};

const MIN_MAP_SIZE = 8;
const MAX_MAP_SIZE = 256;
const MAX_ENTRANCE_LENGTH = 16;
const MAX_INVENTION_CATEGORY = 30;

/**
 * Converts a parsed scenario JSON document into a ScenarioDef. Every field is checked, and the
 * error names the scenario id and the offending field, so a bad file fails before a game starts.
 */
export function parseScenarioFile(raw: unknown): ScenarioDef {
  const root = object(raw, 'document');
  const ctx = typeof root.id === 'string' && root.id !== '' ? root.id : '(unnamed)';
  const fail = (message: string): never => {
    throw new Error(`Scenario ${ctx}: ${message}`);
  };
  const check = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (err) {
      return fail((err as Error).message);
    }
  };

  const id = check(() => text(root.id, 'id'));
  const name = check(() => text(root.name, 'name'));
  const description =
    root.description === undefined ? undefined : check(() => text(root.description, 'description'));

  const map = check(() => object(root.map, 'map'));
  const finance = check(() => object(root.finance, 'finance'));
  const pricing = check(() => object(root.pricing, 'pricing'));
  const research = check(() => object(root.research ?? {}, 'research'));

  const def: ScenarioDef = {
    id,
    name,
    ...(description === undefined ? {} : { description }),
    seed: check(() => integer(root.seed, 'seed', 0, 0xffffffff)),
    mapWidth: check(() => integer(map.width, 'map.width', MIN_MAP_SIZE, MAX_MAP_SIZE)),
    mapHeight: check(() => integer(map.height, 'map.height', MIN_MAP_SIZE, MAX_MAP_SIZE)),
    startingCash: check(() => integer(finance.startingCash, 'finance.startingCash', 0, MAX_SAFE)),
    startingLoan: check(() => integer(finance.startingLoan, 'finance.startingLoan', 0, MAX_SAFE)),
    maxLoan: check(() => integer(finance.maxLoan, 'finance.maxLoan', 0, MAX_SAFE)),
    annualInterestBps: check(() =>
      integer(finance.annualInterestBps, 'finance.annualInterestBps', 0, 10_000),
    ),
    priceMode: check(() => oneOf(pricing.mode, 'pricing.mode', PRICE_MODES)),
    admissionPrice: check(() =>
      pricing.admissionPrice === undefined
        ? 0
        : integer(pricing.admissionPrice, 'pricing.admissionPrice', 0, MAX_SAFE),
    ),
    availableItemIds: check(() =>
      array(research.availableItemIds ?? [], 'research.availableItemIds').map((v, i) =>
        integer(v, `research.availableItemIds[${i}]`, 0, MAX_SAFE),
      ),
    ),
    inventions: check(() =>
      array(research.inventions ?? [], 'research.inventions').map((v, i) => {
        const inv = object(v, `research.inventions[${i}]`);
        return {
          itemId: integer(inv.itemId, `research.inventions[${i}].itemId`, 0, MAX_SAFE),
          category: integer(
            inv.category,
            `research.inventions[${i}].category`,
            0,
            MAX_INVENTION_CATEGORY,
          ),
          costCents: integer(inv.costCents, `research.inventions[${i}].costCents`, 0, MAX_SAFE),
        };
      }),
    ),
    objective: check(() => objective(root.objective)),
  };
  if (root.entrance !== undefined) def.entrance = check(() => entrance(root.entrance));
  return def;
}

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

function objective(v: unknown): ScenarioDef['objective'] {
  const o = object(v, 'objective');
  const kind = oneOf(o.kind, 'objective.kind', OBJECTIVE_KINDS);
  const categoryMask =
    kind === ObjectiveKind.MonthlyIncome
      ? array(o.categories, 'objective.categories').reduce<number>(
          (mask, c, i) => mask | (1 << oneOf(c, `objective.categories[${i}]`, LEDGER_CATEGORIES)),
          0,
        )
      : 0;
  if (kind === ObjectiveKind.MonthlyIncome && categoryMask === 0) {
    throw new Error('objective.categories must name at least one ledger category');
  }
  return {
    kind,
    target: integer(o.target, 'objective.target', -MAX_SAFE, MAX_SAFE),
    rating: o.rating === undefined ? 0 : integer(o.rating, 'objective.rating', 0, 999),
    categoryMask,
    byTick: deadline(o),
  };
}

/** Deadlines are written as whole years (`byYear`, 1-based: year 1 ends at the start of year 2) or raw ticks. */
function deadline(o: Json): number {
  if (o.byYear !== undefined)
    return integer(o.byYear, 'objective.byYear', 1, 1000) * TICKS_PER_YEAR;
  if (o.byTick !== undefined) return integer(o.byTick, 'objective.byTick', 1, MAX_SAFE);
  throw new Error('objective must set byYear or byTick');
}

function entrance(v: unknown): ScenarioEntrance {
  const e = object(v, 'entrance');
  return {
    side: oneOf(e.side, 'entrance.side', SIDES),
    length: integer(e.length, 'entrance.length', 1, MAX_ENTRANCE_LENGTH),
  };
}

function object(v: unknown, path: string): Json {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new Error(`${path} must be an object`);
  }
  return v as Json;
}

function array(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new Error(`${path} must be an array`);
  return v;
}

function text(v: unknown, path: string): string {
  if (typeof v !== 'string' || v.trim() === '')
    throw new Error(`${path} must be a non-empty string`);
  return v;
}

function integer(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) {
    throw new Error(`${path} must be an integer from ${min} to ${max}`);
  }
  return v;
}

function oneOf<T>(v: unknown, path: string, options: Record<string, T>): T {
  if (typeof v !== 'string' || !Object.prototype.hasOwnProperty.call(options, v)) {
    throw new Error(`${path} must be one of ${Object.keys(options).join(', ')}`);
  }
  return options[v];
}
