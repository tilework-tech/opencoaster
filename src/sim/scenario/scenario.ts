import type { World } from '../core/world';
import type { LedgerCategory, PriceMode } from '../economy/ledger';
import type { ResearchInvention } from '../research/research';
import { DEFAULT_CLIMATE } from '../weather/weather';
import type { Climate } from '../weather/weather';

/** Save-slot ids for games that are not scenarios: the development sandbox, and imported files. */
export const SANDBOX_ID = 'sandbox';
export const IMPORTED_ID = 'imported';

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
  difficultRating: boolean;
  priceMode: PriceMode;
  admissionPrice: number;
  availableItemIds: number[];
  inventions: ResearchInvention[];
  entrance?: ScenarioEntrance;
  climate?: Climate;
  objective: ScenarioObjective;
}

export interface ScenarioState {
  objective: ScenarioObjective | null;
  status: ScenarioStatus;
}

export function createScenarioState(): ScenarioState {
  return { objective: null, status: ScenarioStatus.Active };
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
  r.currentIndex = -1;
  r.progress = 0;

  world.scenario.objective = { ...def.objective };
  world.scenario.status = ScenarioStatus.Active;
  world.weather.climate = def.climate ?? DEFAULT_CLIMATE;
}

/** Bitmask helper for MonthlyIncome objectives. */
export function categoryBit(category: LedgerCategory): number {
  return 1 << category;
}
