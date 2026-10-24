import { BreakdownReason } from './breakdown-reasons';
import type { BreakdownWeight } from './breakdown-reasons';
import { FERRIS_BACKWARD_EXCITEMENT, RideMode, modeDef } from './ride-modes';
import type { RideModeDef } from './ride-modes';
import { kmhToSpeedQ8 } from '../vehicles/speed-units';
import type { RatingProfile } from '../vehicles/vehicle-ratings';

export enum RideType {
  MerryGoRound = 1,
  SwingingShip,
  FerrisWheel,
  Twist,
  FoodStall,
  DrinkStall,
  InformationKiosk,
  Toilets,
  WoodenCoaster,
  SteelLoopingCoaster,
}

export type RideCategory =
  'gentle' | 'thrill' | 'coaster' | 'water' | 'shop' | 'stall' | 'facility';

/** What a track-based ride type may be built from. */
export interface TrackRules {
  /** Highest height level any part of the track may reach. */
  maxLevel: number;
  steepSlopes: boolean;
  inversions: boolean;
  launch: boolean;
  /** Whether trains of the ride can collide. */
  crashable: boolean;
  /** Cars not fixed to the track crash above the crest and drop speed limits. */
  unattachedCars: boolean;
}

/** Static, data-driven ride definition. Values are original OpenCoaster tuning data. */
export interface RideTypeDef {
  id: RideType;
  name: string;
  category: RideCategory;
  /** Build cost in cents. */
  cost: number;
  footprint: ReadonlyArray<readonly [dx: number, dy: number]>;
  /** Whether a track editor supplies the layout and ride test measurements. */
  usesTrack: boolean;
  /** Guests served in one dispatch; for stalls this is service capacity. */
  capacity: number;
  loadTicks: number;
  runTicks: number;
  unloadTicks: number;
  /** Ratings use hundredths, e.g. 375 means 3.75. */
  baseExcitement: number;
  baseIntensity: number;
  baseNausea: number;
  /**
   * Ride value coefficients for excitement, intensity and nausea (see `rideValueUnits`). Stalls
   * and facilities have none: they sell items rather than rides.
   */
  valueWeights: readonly [excitement: number, intensity: number, nausea: number];
  /** Modes the player may select, the first being the default for a new ride. */
  modes: readonly RideModeDef[];
  /** Reliability lost at each check before the age multiplier, in 1/256 percent. */
  unreliability: number;
  /** Failures this type can suffer and their relative odds; empty when it never breaks down. */
  breakdowns: readonly BreakdownWeight[];
  /** Price a new ride or stall starts at, in cents. */
  defaultPriceCents: number;
  inspectionIntervalTicks: number;
  /** Present on ride types that set `usesTrack`. */
  trackRules?: TrackRules;
  /** Rating base values, multipliers and requirements for track rides. */
  ratingProfile?: RatingProfile;
}

/** One minute of the original game's inspection clock, at 40 ticks a second. */
export const INSPECTION_MINUTE_TICKS = 40 * 60;
/** Inspection intervals the player can pick, in minutes; 0 means never. */
export const INSPECTION_INTERVAL_MINUTES = [10, 20, 30, 45, 60, 120] as const;
/** New rides ask for a mechanic every 30 minutes. */
const INSPECTION_INTERVAL_TICKS = 30 * INSPECTION_MINUTE_TICKS;

const weights = (reason: BreakdownReason, weight: number): BreakdownWeight => ({ reason, weight });

const FLAT_WITH_RESTRAINTS: readonly BreakdownWeight[] = [
  weights(BreakdownReason.SafetyCutOut, 20),
  weights(BreakdownReason.RestraintsStuckClosed, 12),
  weights(BreakdownReason.RestraintsStuckOpen, 10),
  weights(BreakdownReason.ControlFailure, 6),
];

const FERRIS_WHEEL_BREAKDOWNS: readonly BreakdownWeight[] = [
  weights(BreakdownReason.SafetyCutOut, 20),
  weights(BreakdownReason.DoorsStuckClosed, 10),
  weights(BreakdownReason.DoorsStuckOpen, 8),
  weights(BreakdownReason.ControlFailure, 4),
];

/** The one worked example in the public breakdown write-up (a mine train coaster). */
const COASTER_BREAKDOWNS: readonly BreakdownWeight[] = [
  weights(BreakdownReason.SafetyCutOut, 25),
  weights(BreakdownReason.RestraintsStuckClosed, 12),
  weights(BreakdownReason.RestraintsStuckOpen, 10),
  weights(BreakdownReason.VehicleMalfunction, 6),
  weights(BreakdownReason.BrakesFailure, 3),
];

const NO_VALUE: RideTypeDef['valueWeights'] = [0, 0, 0];
const SHOP_MODES = [modeDef(RideMode.Shop, 'Shop')];
const COASTER_MODES = [modeDef(RideMode.ContinuousCircuit, 'Continuous circuit')];

export const RIDE_CATALOG: Readonly<Record<RideType, RideTypeDef>> = {
  [RideType.MerryGoRound]: {
    id: RideType.MerryGoRound,
    name: 'Merry-Go-Round',
    category: 'gentle',
    cost: 120_000,
    footprint: [[0, 0]],
    usesTrack: false,
    capacity: 16,
    loadTicks: 80,
    runTicks: 320,
    unloadTicks: 80,
    baseExcitement: 360,
    baseIntensity: 120,
    baseNausea: 40,
    valueWeights: [60, 16, 10],
    modes: [modeDef(RideMode.Rotation, 'Rotation')],
    unreliability: 4,
    breakdowns: FLAT_WITH_RESTRAINTS,
    defaultPriceCents: 0,
    inspectionIntervalTicks: INSPECTION_INTERVAL_TICKS,
  },
  [RideType.SwingingShip]: {
    id: RideType.SwingingShip,
    name: 'Swinging Ship',
    category: 'thrill',
    cost: 180_000,
    footprint: [[0, 0]],
    usesTrack: false,
    capacity: 24,
    loadTicks: 100,
    runTicks: 480,
    unloadTicks: 100,
    baseExcitement: 620,
    baseIntensity: 540,
    baseNausea: 310,
    valueWeights: [50, 32, 10],
    modes: [modeDef(RideMode.Swing, 'Swing')],
    unreliability: 7,
    breakdowns: FLAT_WITH_RESTRAINTS,
    defaultPriceCents: 0,
    inspectionIntervalTicks: INSPECTION_INTERVAL_TICKS,
  },
  [RideType.FerrisWheel]: {
    id: RideType.FerrisWheel,
    name: 'Ferris Wheel',
    category: 'gentle',
    cost: 160_000,
    footprint: [[0, 0]],
    usesTrack: false,
    capacity: 32,
    loadTicks: 120,
    runTicks: 640,
    unloadTicks: 120,
    baseExcitement: 450,
    baseIntensity: 100,
    baseNausea: 20,
    valueWeights: [60, 16, 10],
    modes: [
      modeDef(RideMode.ForwardRotation, 'Forward rotation'),
      modeDef(RideMode.BackwardRotation, 'Backward rotation', {
        excitement: FERRIS_BACKWARD_EXCITEMENT,
      }),
    ],
    unreliability: 4,
    breakdowns: FERRIS_WHEEL_BREAKDOWNS,
    defaultPriceCents: 0,
    inspectionIntervalTicks: INSPECTION_INTERVAL_TICKS,
  },
  [RideType.Twist]: {
    id: RideType.Twist,
    name: 'Twist',
    category: 'thrill',
    cost: 150_000,
    footprint: [[0, 0]],
    usesTrack: false,
    capacity: 20,
    loadTicks: 80,
    runTicks: 400,
    unloadTicks: 80,
    baseExcitement: 580,
    baseIntensity: 680,
    baseNausea: 460,
    valueWeights: [50, 32, 10],
    modes: [modeDef(RideMode.Rotation, 'Rotation')],
    unreliability: 8,
    breakdowns: FLAT_WITH_RESTRAINTS,
    defaultPriceCents: 0,
    inspectionIntervalTicks: INSPECTION_INTERVAL_TICKS,
  },
  [RideType.FoodStall]: {
    id: RideType.FoodStall,
    name: 'Food Stall',
    category: 'stall',
    cost: 20_000,
    footprint: [[0, 0]],
    usesTrack: false,
    capacity: 1,
    loadTicks: 0,
    runTicks: 60,
    unloadTicks: 0,
    baseExcitement: 0,
    baseIntensity: 0,
    baseNausea: 0,
    valueWeights: NO_VALUE,
    modes: SHOP_MODES,
    unreliability: 0,
    breakdowns: [],
    defaultPriceCents: 120,
    inspectionIntervalTicks: INSPECTION_INTERVAL_TICKS,
  },
  [RideType.DrinkStall]: {
    id: RideType.DrinkStall,
    name: 'Drink Stall',
    category: 'stall',
    cost: 20_000,
    footprint: [[0, 0]],
    usesTrack: false,
    capacity: 1,
    loadTicks: 0,
    runTicks: 50,
    unloadTicks: 0,
    baseExcitement: 0,
    baseIntensity: 0,
    baseNausea: 0,
    valueWeights: NO_VALUE,
    modes: SHOP_MODES,
    unreliability: 0,
    breakdowns: [],
    defaultPriceCents: 80,
    inspectionIntervalTicks: INSPECTION_INTERVAL_TICKS,
  },
  [RideType.InformationKiosk]: {
    id: RideType.InformationKiosk,
    name: 'Information Kiosk',
    category: 'stall',
    cost: 15_000,
    footprint: [[0, 0]],
    usesTrack: false,
    capacity: 1,
    loadTicks: 0,
    runTicks: 40,
    unloadTicks: 0,
    baseExcitement: 0,
    baseIntensity: 0,
    baseNausea: 0,
    valueWeights: NO_VALUE,
    modes: SHOP_MODES,
    unreliability: 0,
    breakdowns: [],
    defaultPriceCents: 100,
    inspectionIntervalTicks: INSPECTION_INTERVAL_TICKS,
  },
  [RideType.Toilets]: {
    id: RideType.Toilets,
    name: 'Toilets',
    category: 'facility',
    cost: 25_000,
    footprint: [[0, 0]],
    usesTrack: false,
    capacity: 2,
    loadTicks: 0,
    runTicks: 100,
    unloadTicks: 0,
    baseExcitement: 0,
    baseIntensity: 0,
    baseNausea: 0,
    valueWeights: NO_VALUE,
    modes: SHOP_MODES,
    unreliability: 0,
    breakdowns: [],
    defaultPriceCents: 20,
    inspectionIntervalTicks: INSPECTION_INTERVAL_TICKS,
  },
  [RideType.WoodenCoaster]: {
    id: RideType.WoodenCoaster,
    name: 'Wooden Coaster',
    category: 'coaster',
    cost: 300_000,
    footprint: [],
    usesTrack: true,
    capacity: 12,
    loadTicks: 120,
    runTicks: 1,
    unloadTicks: 80,
    baseExcitement: 120,
    baseIntensity: 60,
    baseNausea: 30,
    valueWeights: [51, 32, 10],
    modes: COASTER_MODES,
    unreliability: 10,
    breakdowns: COASTER_BREAKDOWNS,
    defaultPriceCents: 0,
    inspectionIntervalTicks: INSPECTION_INTERVAL_TICKS,
    trackRules: {
      maxLevel: 40,
      steepSlopes: false,
      inversions: false,
      launch: false,
      crashable: true,
      unattachedCars: true,
    },
    ratingProfile: {
      base: { excitement: 120, intensity: 60, nausea: 30 },
      multiplierPercent: { excitement: 100, intensity: 100, nausea: 100 },
      requirements: {
        minLength: 1024,
        minDropHeight: 128,
        minMaxSpeedQ8: kmhToSpeedQ8(30),
        minDropCount: 1,
      },
    },
  },
  [RideType.SteelLoopingCoaster]: {
    id: RideType.SteelLoopingCoaster,
    name: 'Steel Looping Coaster',
    category: 'coaster',
    cost: 450_000,
    footprint: [],
    usesTrack: true,
    capacity: 16,
    loadTicks: 120,
    runTicks: 1,
    unloadTicks: 80,
    baseExcitement: 160,
    baseIntensity: 90,
    baseNausea: 45,
    valueWeights: [51, 32, 10],
    modes: COASTER_MODES,
    unreliability: 14,
    breakdowns: COASTER_BREAKDOWNS,
    defaultPriceCents: 0,
    inspectionIntervalTicks: INSPECTION_INTERVAL_TICKS,
    trackRules: {
      maxLevel: 80,
      steepSlopes: true,
      inversions: true,
      launch: true,
      crashable: true,
      unattachedCars: false,
    },
    ratingProfile: {
      base: { excitement: 160, intensity: 90, nausea: 45 },
      multiplierPercent: { excitement: 110, intensity: 105, nausea: 100 },
      requirements: {
        minLength: 1536,
        minDropHeight: 192,
        minMaxSpeedQ8: kmhToSpeedQ8(40),
        minDropCount: 1,
      },
    },
  },
};
