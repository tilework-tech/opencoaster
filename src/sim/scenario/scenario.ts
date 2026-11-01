import type { World } from '../core/world';
import type { LedgerCategory, PriceMode } from '../economy/ledger';
import type { ResearchInvention } from '../research/research';
import { Funding } from '../research/research';
import { DEFAULT_CLIMATE } from '../weather/weather';
import type { Climate } from '../weather/weather';
import type { ScenarioRestrictions } from './restrictions';

/** Save-slot ids for games that are not scenarios: the development sandbox, and imported files. */
export const SANDBOX_ID = 'sandbox';
export const IMPORTED_ID = 'imported';
/** RCT2's common guest-cash setting; individual scenarios may choose another average. */
export const DEFAULT_AVERAGE_GUEST_CASH_CENTS = 5_000;

export enum ObjectiveKind {
  /** Guest count reaches target by byTick. */
  Guests,
  /** Park value reaches target by byTick. */
  ParkValue,
  /** Guest count reaches target and park rating reaches rating by byTick. */
  GuestsAndRating,
  /** Loan balance is zero and park value reaches target by byTick. */
  RepayLoanAndParkValue,
  /** Net of the categories in categoryMask for the last completed month reaches target. */
  MonthlyIncome,
  /** Qualifying ride count reaches target by byTick. */
  QualifyingRides,
  /** Number of rides built (open or closed) reaches target by byTick. */
  BuildRides,
  /** Coaster types with the configured excitement and length reach target by byTick. */
  QualifyingCoasters,
  /** Completed coasters with the configured excitement reach target by byTick. */
  CompleteCoasters,
  /** At least one open ride reaches the excitement target by byTick. */
  BestRide,
  /** Open-ended scenario with no terminal deadline. */
  HaveFun,
}

export enum ScenarioStatus {
  Active,
  Won,
  Lost,
}

/** Flat numeric record so it hashes and saves like other sim state. */
export interface ScenarioObjective {
  kind: ObjectiveKind;
  target: number;
  rating: number;
  /** Bit per LedgerCategory, used by MonthlyIncome. */
  categoryMask: number;
  byTick: number;
  minimumExcitement?: number;
  minimumLength?: number;
  minimumRating?: number;
}

export type EntranceSide = 'north' | 'east' | 'south' | 'west';
export type ScenarioCategory = 'beginner' | 'challenging' | 'expert' | 'real' | 'other';

/** Gate on the owned edge facing `side`, with a straight path of `length` tiles leading inward. */
export interface ScenarioEntrance {
  side: EntranceSide;
  length: number;
}

export type TerrainSurface = 'grass' | 'sand' | 'dirt' | 'rock';

/** Elliptical depression: `x`/`y` are the centre as a percent of the map, radii are in tiles. */
export interface ScenarioLake {
  x: number;
  y: number;
  rx: number;
  ry: number;
  /** Levels the centre sits below the sea surface. */
  depth: number;
}

/** Round rise: `x`/`y` are the centre as a percent of the map, `radius` is in tiles. */
export interface ScenarioHill {
  x: number;
  y: number;
  radius: number;
  height: number;
}

/**
 * Hand-authored terrain recipe. The generator layers coarse seeded noise, hills and lakes over a
 * base level, then flattens a build apron in front of the gate.
 */
export interface ScenarioTerrain {
  seaLevel: number;
  baseLevel: number;
  /** Peak-to-peak amplitude of the coarse noise, in levels. */
  relief: number;
  /** Noise cell size in tiles. */
  cell: number;
  surface: TerrainSurface;
  /** Height of the flat apron, which is always dry and tree-free. */
  buildLevel: number;
  /** Apron extent inward from the gate edge, and across it, in tiles. */
  buildLength: number;
  buildWidth: number;
  lakes: ScenarioLake[];
  hills: ScenarioHill[];
  /** Ground above `level` takes this surface instead of `surface`, for themed uplands. */
  highland?: ScenarioHighland;
}

/** Surface for dry ground at or above an absolute height level (uplands, mesa tops). */
export interface ScenarioHighland {
  surface: TerrainSurface;
  level: number;
}

/** Share of the map inset (percent per side) that is owned at the start, and how much of the rest is for sale. */
export interface ScenarioLand {
  ownedMarginPercent: number;
  /** Percent of each side, from the border, that is not for sale. */
  saleMarginPercent: number;
}

export const TREE_SPECIES = [
  'oak',
  'conifer',
  'birch',
  'blossom',
  'autumn',
  'topiary',
  'palm',
  'cactus',
] as const;
export type TreeSpecies = (typeof TREE_SPECIES)[number];

export interface ScenarioTrees {
  count: number;
  groves: number;
  clearWidth?: number;
  clearLength?: number;
  shrubs?: number;
  flowerBeds?: number;
  /** Species the trees may use. Defaults by ground: broadleaf and conifer on grass, cactus on sand. */
  species?: TreeSpecies[];
}

/** A ride or stall already standing at the start, placed on the gate's park grid. */
export interface PrebuiltRide {
  type: string;
  /** Tiles inward from the gate along the spine path. */
  row: number;
  /** Signed tiles across the spine; the sign picks the side. */
  lateral: number;
}

export interface ScenarioDef {
  id: string;
  name: string;
  category?: ScenarioCategory;
  description?: string;
  seed: number;
  mapWidth: number;
  mapHeight: number;
  startingCash: number;
  startingLoan: number;
  maxLoan: number;
  annualInterestBps: number;
  averageGuestCashCents: number;
  difficultRating: boolean;
  priceMode: PriceMode;
  admissionPrice: number;
  availableItemIds: number[];
  inventions: ResearchInvention[];
  entrance?: ScenarioEntrance;
  climate?: Climate;
  terrain?: ScenarioTerrain;
  land?: ScenarioLand;
  trees?: ScenarioTrees;
  prebuilt?: PrebuiltRide[];
  restrictions?: ScenarioRestrictions;
  objective: ScenarioObjective;
}

export interface ScenarioState {
  objective: ScenarioObjective | null;
  status: ScenarioStatus;
  averageGuestCashCents: number;
  /** The rules the park started with; saves without them load unrestricted. */
  restrictions: ScenarioRestrictions;
}

export function createScenarioState(): ScenarioState {
  return {
    objective: null,
    status: ScenarioStatus.Active,
    averageGuestCashCents: DEFAULT_AVERAGE_GUEST_CASH_CENTS,
    restrictions: {},
  };
}

/** Sets starting finances, research catalogue and objective. Call once, before stepping. */
export function applyScenario(world: World, def: ScenarioDef): void {
  const l = world.economy;
  l.cash = def.startingCash;
  l.loan = def.startingLoan;
  l.maxLoan = def.maxLoan;
  l.annualInterestBps = def.annualInterestBps;
  l.difficultRating = def.difficultRating;
  l.priceMode = def.priceMode;
  l.admissionPrice = def.admissionPrice;

  const r = world.research;
  r.inventions = def.inventions.map((inv) => ({ ...inv }));
  r.unlocked = new Set(def.availableItemIds);
  const researchable = r.inventions.filter((invention) => !r.unlocked.has(invention.itemId));
  r.funding = researchable.length > 0 ? Funding.Normal : Funding.None;
  r.enabledCategoryMask = researchable.reduce(
    (mask, invention) => mask | (1 << invention.category),
    0,
  );
  r.priority = [];
  r.currentIndex = -1;
  r.progress = 0;

  world.scenario.objective = { ...def.objective };
  world.scenario.status = ScenarioStatus.Active;
  world.scenario.averageGuestCashCents = def.averageGuestCashCents;
  world.scenario.restrictions = structuredClone(def.restrictions ?? {});
  world.weather.climate = def.climate ?? DEFAULT_CLIMATE;
}

/** Bitmask helper for MonthlyIncome objectives. */
export function categoryBit(category: LedgerCategory): number {
  return 1 << category;
}
