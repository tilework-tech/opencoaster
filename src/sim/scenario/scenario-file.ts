import { TICKS_PER_YEAR } from '../economy/calendar';
import { LedgerCategory, PriceMode } from '../economy/ledger';
import { Climate } from '../weather/weather';
import {
  DEFAULT_AVERAGE_GUEST_CASH_CENTS,
  IMPORTED_ID,
  ObjectiveKind,
  SANDBOX_ID,
  TREE_SPECIES,
} from './scenario';
import { MAX_HEIGHT, OWNED } from '../map/tile-map';
import { buildApron, DEFAULT_LAND, landOwnership } from './scenario-map';
import { PREBUILT_TYPES } from './scenario-prebuilt';
import { parseRestrictions } from './restrictions';
import type {
  EntranceSide,
  LandParcel,
  ParcelKind,
  PrebuiltRide,
  ScenarioCategory,
  ScenarioDef,
  ScenarioEntrance,
  ScenarioHighland,
  ScenarioHill,
  ScenarioLake,
  ScenarioLand,
  ScenarioShape,
  ScenarioTerrain,
  ScenarioTrees,
  TerrainShape,
  TerrainSurface,
  TreeSpecies,
  TreeStand,
} from './scenario';

type Json = Record<string, unknown>;

const OBJECTIVE_KINDS: Record<string, ObjectiveKind> = {
  guests: ObjectiveKind.Guests,
  guestsByDate: ObjectiveKind.Guests,
  parkValue: ObjectiveKind.ParkValue,
  parkValueByDate: ObjectiveKind.ParkValue,
  guestsAndRating: ObjectiveKind.GuestsAndRating,
  repayLoanAndParkValue: ObjectiveKind.RepayLoanAndParkValue,
  monthlyIncome: ObjectiveKind.MonthlyIncome,
  qualifyingRides: ObjectiveKind.QualifyingRides,
  buildRides: ObjectiveKind.BuildRides,
  qualifyingCoasters: ObjectiveKind.QualifyingCoasters,
  completeCoasters: ObjectiveKind.CompleteCoasters,
  bestRide: ObjectiveKind.BestRide,
  haveFun: ObjectiveKind.HaveFun,
  monthlyRideIncome: ObjectiveKind.MonthlyIncome,
  monthlyFoodProfit: ObjectiveKind.MonthlyIncome,
};

const PRICE_MODES: Record<string, PriceMode> = {
  free: PriceMode.Free,
  admission: PriceMode.Admission,
  perRide: PriceMode.PerRide,
};

const SCENARIO_CATEGORIES: Record<string, ScenarioCategory> = {
  beginner: 'beginner',
  challenging: 'challenging',
  expert: 'expert',
  real: 'real',
  other: 'other',
};

const CLIMATES: Record<string, Climate> = {
  cold: Climate.Cold,
  coolAndWet: Climate.CoolAndWet,
  hotAndDry: Climate.HotAndDry,
  warm: Climate.Warm,
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

const TERRAIN_SURFACES: Record<TerrainSurface, TerrainSurface> = {
  grass: 'grass',
  sand: 'sand',
  dirt: 'dirt',
  rock: 'rock',
};

const TREE_SPECIES_BY_NAME = Object.fromEntries(TREE_SPECIES.map((s) => [s, s])) as Record<
  TreeSpecies,
  TreeSpecies
>;

const PARCEL_KINDS: Record<ParcelKind, ParcelKind> = {
  owned: 'owned',
  land: 'land',
  rights: 'rights',
  none: 'none',
};

const SHAPE_MODES: Record<TerrainShape['mode'], TerrainShape['mode']> = {
  raise: 'raise',
  lower: 'lower',
};

const MAX_TREES = 2000;
const MAX_SHAPES = 64;
const MAX_BAND_HALF_WIDTH = 32;
const MAX_SHAPE_RUN = 8;
const MAX_PREBUILT = 40;
const MAX_PREBUILT_ROW = 60;
const MIN_MAP_SIZE = 8;
const MAX_MAP_SIZE = 256;
const MAX_ENTRANCE_LENGTH = 16;
const MAX_INVENTION_CATEGORY = 30;
/** Money stays exact in doubles through the sums a long game adds up, far beyond any sensible park. */
const MAX_MONEY = 1_000_000_000_000;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const RESERVED_IDS: readonly string[] = [SANDBOX_ID, IMPORTED_ID];

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
  if (RESERVED_IDS.includes(id)) fail(`id ${id} is reserved for non-scenario saves`);
  const name = check(() => text(root.name, 'name'));
  const description =
    root.description === undefined ? undefined : check(() => text(root.description, 'description'));
  const landscape =
    root.landscape === undefined ? undefined : check(() => text(root.landscape, 'landscape'));
  const challenge =
    root.challenge === undefined ? undefined : check(() => text(root.challenge, 'challenge'));

  const map = check(() => object(root.map, 'map'));
  const finance = check(() => object(root.finance, 'finance'));
  const guests = check(() => object(root.guests ?? {}, 'guests'));
  const pricing = check(() => object(root.pricing, 'pricing'));
  const research = check(() => object(root.research ?? {}, 'research'));

  const def: ScenarioDef = {
    id,
    name,
    category: check(() => oneOf(root.category ?? 'beginner', 'category', SCENARIO_CATEGORIES)),
    ...(description === undefined ? {} : { description }),
    ...(landscape === undefined ? {} : { landscape }),
    ...(challenge === undefined ? {} : { challenge }),
    ...(root.climate === undefined
      ? {}
      : { climate: check(() => oneOf(root.climate, 'climate', CLIMATES)) }),
    seed: check(() => integer(root.seed, 'seed', 0, 0xffffffff)),
    mapWidth: check(() => integer(map.width, 'map.width', MIN_MAP_SIZE, MAX_MAP_SIZE)),
    mapHeight: check(() => integer(map.height, 'map.height', MIN_MAP_SIZE, MAX_MAP_SIZE)),
    startingCash: check(() => integer(finance.startingCash, 'finance.startingCash', 0, MAX_MONEY)),
    startingLoan: check(() => integer(finance.startingLoan, 'finance.startingLoan', 0, MAX_MONEY)),
    maxLoan: check(() => integer(finance.maxLoan, 'finance.maxLoan', 0, MAX_MONEY)),
    annualInterestBps: check(() =>
      integer(finance.annualInterestBps, 'finance.annualInterestBps', 0, 10_000),
    ),
    averageGuestCashCents: check(() =>
      guests.averageCashCents === undefined
        ? DEFAULT_AVERAGE_GUEST_CASH_CENTS
        : integer(guests.averageCashCents, 'guests.averageCashCents', 0, 2_000_000_000),
    ),
    difficultRating: check(() => flag(root.difficultRating, 'difficultRating')),
    priceMode: check(() => oneOf(pricing.mode, 'pricing.mode', PRICE_MODES)),
    admissionPrice: check(() =>
      pricing.admissionPrice === undefined
        ? 0
        : integer(pricing.admissionPrice, 'pricing.admissionPrice', 0, MAX_MONEY),
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
          workUnits: integer(inv.workUnits, `research.inventions[${i}].workUnits`, 0, MAX_SAFE),
        };
      }),
    ),
    objective: check(() => objective(root.objective)),
  };
  if (def.startingLoan > def.maxLoan) fail('finance.startingLoan must not exceed finance.maxLoan');
  if (root.entrance !== undefined) def.entrance = check(() => entrance(root.entrance));
  if (root.land !== undefined) def.land = check(() => land(root.land, def));
  if (root.terrain !== undefined) def.terrain = check(() => terrain(root.terrain, def));
  if (root.trees !== undefined) def.trees = check(() => trees(root.trees, def));
  if (root.prebuilt !== undefined) def.prebuilt = check(() => prebuilt(root.prebuilt, def));
  if (root.restrictions !== undefined) {
    def.restrictions = check(() => parseRestrictions(root.restrictions));
    check(() => checkForbiddenRides(def));
  }
  return def;
}

/** A forbidden ride type must not be available, researchable or standing at the start. */
function checkForbiddenRides(def: ScenarioDef): void {
  for (const id of def.restrictions?.forbiddenRideTypeIds ?? []) {
    const clash = def.availableItemIds.includes(id)
      ? 'research.availableItemIds'
      : def.inventions.some((inv) => inv.itemId === id)
        ? 'research.inventions'
        : def.prebuilt?.some((ride) => PREBUILT_TYPES[ride.type] === id)
          ? 'prebuilt'
          : undefined;
    if (clash)
      throw new Error(
        `restrictions.forbiddenRideTypeIds: ride type ${id} is forbidden but listed in ${clash}`,
      );
  }
}

function objective(v: unknown): ScenarioDef['objective'] {
  const o = object(v, 'objective');
  const kind = oneOf(o.kind, 'objective.kind', OBJECTIVE_KINDS);
  const monthlyCategories =
    o.kind === 'monthlyRideIncome'
      ? ['rideTickets']
      : o.kind === 'monthlyFoodProfit'
        ? ['foodDrinkSales', 'foodDrinkStock']
        : o.categories;
  const categoryMask =
    kind === ObjectiveKind.MonthlyIncome
      ? array(monthlyCategories, 'objective.categories').reduce<number>(
          (mask, c, i) => mask | (1 << oneOf(c, `objective.categories[${i}]`, LEDGER_CATEGORIES)),
          0,
        )
      : 0;
  if (kind === ObjectiveKind.MonthlyIncome && categoryMask === 0) {
    throw new Error('objective.categories must name at least one ledger category');
  }
  return {
    kind,
    target:
      kind === ObjectiveKind.HaveFun && o.target === undefined
        ? 0
        : integer(o.target, 'objective.target', 0, MAX_MONEY),
    rating: o.rating === undefined ? 0 : integer(o.rating, 'objective.rating', 0, 999),
    minimumRating:
      o.minimumRating === undefined
        ? 0
        : integer(o.minimumRating, 'objective.minimumRating', 0, 999),
    minimumExcitement:
      o.minimumExcitement === undefined
        ? 0
        : integer(o.minimumExcitement, 'objective.minimumExcitement', 0, 10_000),
    minimumLength:
      o.minimumLength === undefined
        ? 0
        : integer(o.minimumLength, 'objective.minimumLength', 0, MAX_SAFE),
    categoryMask,
    byTick: kind === ObjectiveKind.HaveFun ? 0 : deadline(o),
  };
}

/**
 * Deadlines are written as whole years (`byYear`, 1-based) or raw ticks. `byYear` judges the
 * objective on the last tick of that year's final month (end of October), so the verdict lands
 * on the same date the UI labels as the deadline.
 */
function deadline(o: Json): number {
  if (o.byYear !== undefined)
    return integer(o.byYear, 'objective.byYear', 1, 1000) * TICKS_PER_YEAR - 1;
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

function land(v: unknown, def: ScenarioDef): ScenarioLand {
  const l = object(v, 'land');
  const out: ScenarioLand = {
    ownedMarginPercent: integer(
      l.ownedMarginPercent ?? DEFAULT_LAND.ownedMarginPercent,
      'land.ownedMarginPercent',
      10,
      45,
    ),
    saleMarginPercent: integer(
      l.saleMarginPercent ?? DEFAULT_LAND.saleMarginPercent,
      'land.saleMarginPercent',
      0,
      20,
    ),
  };
  if (l.parcels === undefined) return out;
  out.parcels = list(l.parcels, 'land.parcels').map((p, i): LandParcel => {
    const path = `land.parcels[${i}]`;
    const parcel = object(p, path);
    return {
      kind: oneOf(parcel.kind, `${path}.kind`, PARCEL_KINDS),
      ...shape(parcel, path, def),
    };
  });
  const flags = landOwnership(def.mapWidth, def.mapHeight, out);
  if (!connectedOwnership(flags, def.mapWidth))
    throw new Error('owned land must be one connected piece');
  return out;
}

/** True when the owned tiles exist and join through edge-sharing neighbours. */
function connectedOwnership(flags: Uint8Array, width: number): boolean {
  const start = flags.findIndex((f) => (f & OWNED) !== 0);
  if (start < 0) return false;
  const seen = new Uint8Array(flags.length);
  const queue = [start];
  seen[start] = 1;
  let reached = 0;
  while (queue.length > 0) {
    const i = queue.pop()!;
    reached++;
    const x = i % width;
    for (const n of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) {
      if (n < 0 || n >= flags.length || seen[n] || !(flags[n] & OWNED)) continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  return reached === flags.reduce((count, f) => count + (f & OWNED ? 1 : 0), 0);
}

/** Reads the one shape key of `o` (rect, ellipse or band), in tiles inside the map. */
function shape(o: Json, path: string, def: ScenarioDef): ScenarioShape {
  const keys = ['rect', 'ellipse', 'band'].filter((k) => o[k] !== undefined);
  if (keys.length !== 1) throw new Error(`${path} must set exactly one of rect, ellipse or band`);
  const key = keys[0];
  const values = array(o[key], `${path}.${key}`);
  const at = (k: number, max: number, min = 0): number =>
    integer(values[k], `${path}.${key}[${k}]`, min, max);
  const w = def.mapWidth - 1;
  const h = def.mapHeight - 1;
  if (key === 'rect') {
    if (values.length !== 4) throw new Error(`${path}.rect must list x0, y0, x1, y1`);
    const x0 = at(0, w);
    const y0 = at(1, h);
    return { rect: [x0, y0, at(2, w, x0), at(3, h, y0)] };
  }
  if (key === 'ellipse') {
    if (values.length !== 4) throw new Error(`${path}.ellipse must list cx, cy, rx, ry`);
    return { ellipse: [at(0, w), at(1, h), at(2, MAX_MAP_SIZE, 1), at(3, MAX_MAP_SIZE, 1)] };
  }
  if (values.length !== 5) throw new Error(`${path}.band must list x0, y0, x1, y1, halfWidth`);
  return { band: [at(0, w), at(1, h), at(2, w), at(3, h), at(4, MAX_BAND_HALF_WIDTH)] };
}

function list(v: unknown, path: string): unknown[] {
  const items = array(v, path);
  if (items.length > MAX_SHAPES) throw new Error(`${path} may list at most ${MAX_SHAPES} shapes`);
  return items;
}

function terrain(v: unknown, def: ScenarioDef): ScenarioTerrain {
  const t = object(v, 'terrain');
  const seaLevel = integer(t.seaLevel, 'terrain.seaLevel', 1, 10);
  const out: ScenarioTerrain = {
    seaLevel,
    baseLevel: integer(t.baseLevel, 'terrain.baseLevel', 1, MAX_HEIGHT - 4),
    relief: integer(t.relief, 'terrain.relief', 0, 12),
    cell: integer(t.cell, 'terrain.cell', 4, 16),
    surface: oneOf(t.surface ?? 'grass', 'terrain.surface', TERRAIN_SURFACES),
    buildLevel: integer(t.buildLevel, 'terrain.buildLevel', seaLevel + 2, MAX_HEIGHT - 6),
    buildLength: integer(t.buildLength, 'terrain.buildLength', 8, MAX_MAP_SIZE),
    buildWidth: integer(t.buildWidth, 'terrain.buildWidth', 5, MAX_MAP_SIZE),
    lakes: array(t.lakes ?? [], 'terrain.lakes').map((l, i) => lake(l, `terrain.lakes[${i}]`)),
    hills: array(t.hills ?? [], 'terrain.hills').map((h, i) => hill(h, `terrain.hills[${i}]`)),
  };
  if (t.apronOffset !== undefined)
    out.apronOffset = integer(t.apronOffset, 'terrain.apronOffset', -MAX_MAP_SIZE, MAX_MAP_SIZE);
  if (t.shapes !== undefined)
    out.shapes = list(t.shapes, 'terrain.shapes').map((v, i): TerrainShape => {
      const path = `terrain.shapes[${i}]`;
      const o = object(v, path);
      return {
        mode: oneOf(o.mode, `${path}.mode`, SHAPE_MODES),
        level: integer(o.level, `${path}.level`, 0, MAX_HEIGHT),
        run: o.run === undefined ? 1 : integer(o.run, `${path}.run`, 1, MAX_SHAPE_RUN),
        ...shape(o, path, def),
      };
    });
  if (t.highland !== undefined) out.highland = highland(t.highland);
  if (def.entrance === undefined)
    throw new Error('terrain needs an entrance to orient the build apron');
  const flags = landOwnership(def.mapWidth, def.mapHeight, def.land);
  const apron = buildApron(def.mapWidth, def.mapHeight, def.entrance.side, out, def.land);
  const owned = (x: number, y: number): boolean =>
    x >= 0 &&
    y >= 0 &&
    x < def.mapWidth &&
    y < def.mapHeight &&
    (flags[y * def.mapWidth + x] & OWNED) !== 0;
  for (let y = apron.y0; y <= apron.y1; y++)
    for (let x = apron.x0; x <= apron.x1; x++)
      if (!owned(x, y))
        throw new Error(
          `terrain build apron (${apron.x0},${apron.y0})-(${apron.x1},${apron.y1}) must fit inside the owned land; tile (${x},${y}) is not owned`,
        );
  return out;
}

function highland(v: unknown): ScenarioHighland {
  const h = object(v, 'terrain.highland');
  return {
    surface: oneOf(h.surface, 'terrain.highland.surface', TERRAIN_SURFACES),
    level: integer(h.level, 'terrain.highland.level', 1, MAX_HEIGHT - 4),
  };
}

function lake(v: unknown, path: string): ScenarioLake {
  const l = object(v, path);
  return {
    x: integer(l.x, `${path}.x`, 0, 100),
    y: integer(l.y, `${path}.y`, 0, 100),
    rx: integer(l.rx, `${path}.rx`, 1, MAX_MAP_SIZE),
    ry: integer(l.ry, `${path}.ry`, 1, MAX_MAP_SIZE),
    depth: integer(l.depth, `${path}.depth`, 0, 8),
  };
}

function hill(v: unknown, path: string): ScenarioHill {
  const h = object(v, path);
  return {
    x: integer(h.x, `${path}.x`, 0, 100),
    y: integer(h.y, `${path}.y`, 0, 100),
    radius: integer(h.radius, `${path}.radius`, 1, MAX_MAP_SIZE),
    height: integer(h.height, `${path}.height`, 0, 12),
  };
}

function trees(v: unknown, def: ScenarioDef): ScenarioTrees {
  const t = object(v, 'trees');
  const out: ScenarioTrees = {
    count: integer(t.count, 'trees.count', 0, MAX_TREES),
    groves: integer(t.groves, 'trees.groves', 1, 100),
  };
  if (t.shrubs !== undefined) out.shrubs = integer(t.shrubs, 'trees.shrubs', 0, MAX_TREES);
  if (t.flowerBeds !== undefined)
    out.flowerBeds = integer(t.flowerBeds, 'trees.flowerBeds', 0, MAX_TREES);
  if (t.clearWidth !== undefined)
    out.clearWidth = integer(t.clearWidth, 'trees.clearWidth', 0, 100);
  if (t.clearLength !== undefined)
    out.clearLength = integer(t.clearLength, 'trees.clearLength', 0, MAX_MAP_SIZE);
  if (t.species !== undefined) {
    const species = array(t.species, 'trees.species');
    if (species.length === 0) throw new Error('trees.species must list at least one species');
    out.species = species.map((s) => oneOf(s, 'trees.species', TREE_SPECIES_BY_NAME));
  }
  if (t.stands !== undefined)
    out.stands = list(t.stands, 'trees.stands').map((v, i): TreeStand => {
      const path = `trees.stands[${i}]`;
      const o = object(v, path);
      return {
        density: integer(o.density, `${path}.density`, 1, 100),
        rocks: o.rocks === undefined ? 0 : integer(o.rocks, `${path}.rocks`, 0, 100),
        ...shape(o, path, def),
      };
    });
  if (t.clearings !== undefined)
    out.clearings = list(t.clearings, 'trees.clearings').map((v, i) =>
      shape(object(v, `trees.clearings[${i}]`), `trees.clearings[${i}]`, def),
    );
  return out;
}

function prebuilt(v: unknown, def: ScenarioDef): PrebuiltRide[] {
  if (def.entrance === undefined) throw new Error('prebuilt rides need an entrance');
  const list = array(v, 'prebuilt');
  if (list.length > MAX_PREBUILT)
    throw new Error(`prebuilt may list at most ${MAX_PREBUILT} rides`);
  return list.map((item, i) => {
    const r = object(item, `prebuilt[${i}]`);
    const lateral = integer(r.lateral, `prebuilt[${i}].lateral`, -30, 30);
    if (Math.abs(lateral) < 2)
      throw new Error(`prebuilt[${i}].lateral must be at least 2 tiles from the spine`);
    oneOf(r.type, `prebuilt[${i}].type`, PREBUILT_TYPES);
    return {
      type: r.type as string,
      row: integer(r.row, `prebuilt[${i}].row`, 2, MAX_PREBUILT_ROW),
      lateral,
    };
  });
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

function flag(v: unknown, path: string): boolean {
  if (v === undefined) return false;
  if (typeof v !== 'boolean') throw new Error(`${path} must be true or false`);
  return v;
}

function oneOf<T>(v: unknown, path: string, options: Record<string, T>): T {
  if (typeof v !== 'string' || !Object.prototype.hasOwnProperty.call(options, v)) {
    throw new Error(`${path} must be one of ${Object.keys(options).join(', ')}`);
  }
  return options[v];
}
