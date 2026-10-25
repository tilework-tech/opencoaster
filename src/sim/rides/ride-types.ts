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
  HauntedHouse,
  SpiralSlide,
  TopSpin,
  Enterprise,
  GoKarts,
  LogFlume,
  RiverRapids,
  MiniatureRailway,
  Monorail,
  Chairlift,
  JuniorRollerCoaster,
  WildMouseCoaster,
  ObservationTower,
  BurgerStall,
}

export type RideCategory =
  'transport' | 'gentle' | 'thrill' | 'coaster' | 'water' | 'shop' | 'stall' | 'facility';

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
  /** Exact piece IDs offered by the family in the current shared track vocabulary. */
  allowedPieces?: readonly number[];
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
  /** What a food or drink stall sells, which decides which guest needs it meets. */
  serves?: 'food' | 'drink';
  /** Present on ride types that set `usesTrack`. */
  trackRules?: TrackRules;
  /** Rating base values, multipliers and requirements for track rides. */
  ratingProfile?: RatingProfile;
  /** Authored starter-scenario discovery ordering; RCT2's order varies by scenario. */
  researchOrder?: number;
  researchCategory?: number;
  researchWorkUnits?: number;
  /** Fortnightly open-ride running cost in cents. */
  runningCostPerFortnightCents?: number;
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
const TRACK_MODES = [
  ...COASTER_MODES,
  modeDef(RideMode.ContinuousCircuitBlockSectioned, 'Continuous circuit block sectioned'),
];

function addedRide(
  id: RideType,
  name: string,
  category: RideCategory,
  cost: number,
  capacity: number,
  ratings: readonly [number, number, number],
  modes: readonly RideModeDef[],
  runningCostPerFortnightCents: number,
  researchCategory: number,
  researchOrder: number,
  unreliability: number,
  opts: {
    usesTrack?: boolean;
    allowedPieces?: readonly number[];
    maxLevel?: number;
    steep?: boolean;
    inversions?: boolean;
  } = {},
): RideTypeDef {
  const usesTrack = opts.usesTrack ?? false;
  return {
    id,
    name,
    category,
    cost,
    footprint: usesTrack ? [] : [[0, 0]],
    usesTrack,
    capacity,
    loadTicks: usesTrack ? 120 : 80,
    runTicks: usesTrack ? 1 : 400,
    unloadTicks: usesTrack ? 80 : 80,
    baseExcitement: ratings[0],
    baseIntensity: ratings[1],
    baseNausea: ratings[2],
    valueWeights: category === 'stall' ? NO_VALUE : [51, 32, 10],
    modes,
    unreliability,
    breakdowns: category === 'stall' ? [] : FLAT_WITH_RESTRAINTS,
    defaultPriceCents: category === 'stall' ? 120 : 0,
    inspectionIntervalTicks: INSPECTION_INTERVAL_TICKS,
    runningCostPerFortnightCents,
    researchCategory,
    researchOrder,
    researchWorkUnits: 180 + researchOrder * 45,
    ...(usesTrack
      ? {
          trackRules: {
            maxLevel: opts.maxLevel ?? 40,
            steepSlopes: opts.steep ?? false,
            inversions: opts.inversions ?? false,
            launch: false,
            crashable: true,
            unattachedCars: false,
            allowedPieces: opts.allowedPieces,
          },
          ratingProfile: {
            base: { excitement: ratings[0], intensity: ratings[1], nausea: ratings[2] },
            multiplierPercent: { excitement: 100, intensity: 100, nausea: 100 },
            requirements: {
              minLength: 768,
              minDropHeight: 64,
              minMaxSpeedQ8: kmhToSpeedQ8(20),
              minDropCount: 1,
            },
          },
        }
      : {}),
  };
}

const JUNIOR_PIECES = [0, 1, 2, 3, 6, 7, 8, 9, 14, 15, 16, 17, 18, 19, 34, 35];
const WILD_MOUSE_PIECES = [
  ...JUNIOR_PIECES,
  4,
  5,
  10,
  11,
  12,
  13,
  20,
  21,
  22,
  23,
  24,
  25,
  26,
  27,
  28,
  29,
  30,
  31,
  38,
  39,
  40,
  41,
  42,
  43,
  44,
  45,
  46,
  47,
  48,
  49,
  50,
  51,
  52,
  53,
  54,
  55,
  56,
  57,
  58,
  59,
  60,
  61,
  62,
  63,
  64,
  65,
];

const RIDE_CATALOG_SOURCE: Record<RideType, RideTypeDef> = {
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
    serves: 'food',
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
    serves: 'drink',
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
  [RideType.HauntedHouse]: addedRide(
    RideType.HauntedHouse,
    'Haunted House',
    'thrill',
    420_000,
    16,
    [520, 390, 300],
    [modeDef(RideMode.HauntedHouse, 'Haunted house')],
    8_400,
    3,
    11,
    6,
  ),
  [RideType.SpiralSlide]: addedRide(
    RideType.SpiralSlide,
    'Spiral Slide',
    'gentle',
    33_000,
    5,
    [150, 140, 90],
    [
      modeDef(RideMode.SpiralSlideSingle, 'Single ride per admission'),
      modeDef(RideMode.SpiralSlideUnlimited, 'Unlimited rides per admission'),
    ],
    660,
    1,
    12,
    4,
  ),
  [RideType.TopSpin]: addedRide(
    RideType.TopSpin,
    'Top Spin',
    'thrill',
    560_000,
    40,
    [650, 820, 620],
    [modeDef(RideMode.Swing, 'Swing')],
    11_200,
    3,
    13,
    8,
  ),
  [RideType.Enterprise]: addedRide(
    RideType.Enterprise,
    'Enterprise',
    'thrill',
    480_000,
    24,
    [700, 650, 500],
    [modeDef(RideMode.Rotation, 'Rotation')],
    9_600,
    3,
    14,
    7,
  ),
  [RideType.GoKarts]: addedRide(
    RideType.GoKarts,
    'Go-Karts',
    'thrill',
    760_000,
    8,
    [620, 580, 450],
    [modeDef(RideMode.Race, 'Race')],
    15_200,
    3,
    15,
    5,
  ),
  [RideType.LogFlume]: addedRide(
    RideType.LogFlume,
    'Log Flume',
    'water',
    132_000,
    20,
    [620, 420, 320],
    [
      modeDef(RideMode.ContinuousCircuit, 'Continuous circuit'),
      modeDef(RideMode.BoatHire, 'Boat hire'),
    ],
    30_000,
    4,
    16,
    8,
  ),
  [RideType.RiverRapids]: addedRide(
    RideType.RiverRapids,
    'River Rapids',
    'water',
    155_000,
    36,
    [680, 500, 480],
    [modeDef(RideMode.ContinuousCircuit, 'Continuous circuit')],
    24_000,
    4,
    17,
    10,
  ),
  [RideType.MiniatureRailway]: addedRide(
    RideType.MiniatureRailway,
    'Miniature Railway',
    'transport',
    450_000,
    16,
    [450, 180, 80],
    COASTER_MODES,
    24_000,
    0,
    18,
    5,
    { usesTrack: true, maxLevel: 30 },
  ),
  [RideType.Monorail]: addedRide(
    RideType.Monorail,
    'Monorail',
    'transport',
    800_000,
    24,
    [520, 220, 100],
    [
      modeDef(RideMode.ContinuousCircuit, 'Continuous circuit'),
      modeDef(RideMode.Shuttle, 'Shuttle'),
    ],
    40_000,
    0,
    19,
    7,
    { usesTrack: true, maxLevel: 50 },
  ),
  [RideType.Chairlift]: addedRide(
    RideType.Chairlift,
    'Chairlift',
    'transport',
    500_000,
    40,
    [500, 120, 50],
    [modeDef(RideMode.StationToStation, 'Station to station')],
    25_000,
    0,
    20,
    6,
    { usesTrack: true, maxLevel: 40 },
  ),
  [RideType.JuniorRollerCoaster]: addedRide(
    RideType.JuniorRollerCoaster,
    'Junior Roller Coaster',
    'coaster',
    132_000,
    8,
    [120, 60, 30],
    TRACK_MODES,
    26_000,
    2,
    21,
    8,
    { usesTrack: true, maxLevel: 65, allowedPieces: JUNIOR_PIECES },
  ),
  [RideType.WildMouseCoaster]: addedRide(
    RideType.WildMouseCoaster,
    'Wild Mouse Coaster',
    'coaster',
    190_000,
    16,
    [150, 80, 60],
    TRACK_MODES,
    38_000,
    2,
    22,
    12,
    { usesTrack: true, maxLevel: 68, steep: true, allowedPieces: WILD_MOUSE_PIECES },
  ),
  [RideType.ObservationTower]: addedRide(
    RideType.ObservationTower,
    'Observation Tower',
    'gentle',
    250_000,
    24,
    [420, 140, 80],
    [modeDef(RideMode.Rotation, 'Rotation')],
    9_000,
    1,
    23,
    4,
  ),
  [RideType.BurgerStall]: {
    ...addedRide(
      RideType.BurgerStall,
      'Burger Stall',
      'stall',
      25_000,
      1,
      [0, 0, 0],
      SHOP_MODES,
      2_500,
      5,
      24,
      0,
    ),
    serves: 'food',
  },
};

const RESEARCH_CATEGORIES: Readonly<Record<RideCategory, number>> = {
  transport: 0,
  gentle: 1,
  coaster: 2,
  thrill: 3,
  water: 4,
  shop: 5,
  stall: 5,
  facility: 5,
};
export const RIDE_CATALOG: Readonly<Record<RideType, RideTypeDef>> = Object.fromEntries(
  Object.values(RIDE_CATALOG_SOURCE).map((def) => [
    def.id,
    {
      ...def,
      researchOrder: def.researchOrder ?? def.id,
      researchCategory: def.researchCategory ?? RESEARCH_CATEGORIES[def.category],
      researchWorkUnits:
        def.researchWorkUnits ??
        (def.id === RideType.SwingingShip
          ? 180
          : def.id === RideType.FerrisWheel
            ? 360
            : 180 + def.id * 45),
      runningCostPerFortnightCents:
        def.runningCostPerFortnightCents ??
        Math.floor(
          def.cost /
            (def.category === 'stall' || def.category === 'shop' || def.category === 'facility'
              ? 100
              : 50),
        ),
    },
  ]),
) as Record<RideType, RideTypeDef>;
