export enum RideType {
  MerryGoRound = 1,
  SwingingShip,
  FerrisWheel,
  Twist,
  FoodStall,
  DrinkStall,
  InformationKiosk,
  Toilets,
}

export type RideCategory =
  'gentle' | 'thrill' | 'coaster' | 'water' | 'shop' | 'stall' | 'facility';

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
  baseValueCents: number;
  inspectionIntervalTicks: number;
}

const HOUR_TICKS = 40 * 60 * 60;
const INSPECTION_INTERVAL_TICKS = HOUR_TICKS;

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
    baseValueCents: 600,
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
    baseValueCents: 900,
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
    baseValueCents: 750,
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
    baseValueCents: 800,
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
    runTicks: 20,
    unloadTicks: 0,
    baseExcitement: 0,
    baseIntensity: 0,
    baseNausea: 0,
    baseValueCents: 0,
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
    runTicks: 20,
    unloadTicks: 0,
    baseExcitement: 0,
    baseIntensity: 0,
    baseNausea: 0,
    baseValueCents: 0,
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
    runTicks: 12,
    unloadTicks: 0,
    baseExcitement: 0,
    baseIntensity: 0,
    baseNausea: 0,
    baseValueCents: 0,
    inspectionIntervalTicks: INSPECTION_INTERVAL_TICKS,
  },
  [RideType.Toilets]: {
    id: RideType.Toilets,
    name: 'Toilets',
    category: 'facility',
    cost: 25_000,
    footprint: [[0, 0]],
    usesTrack: false,
    capacity: 1,
    loadTicks: 0,
    runTicks: 40,
    unloadTicks: 0,
    baseExcitement: 0,
    baseIntensity: 0,
    baseNausea: 0,
    baseValueCents: 0,
    inspectionIntervalTicks: INSPECTION_INTERVAL_TICKS,
  },
};
