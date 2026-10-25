export const enum WeatherKind {
  Sunny = 0,
  Cloudy = 1,
  Rain = 2,
  Storm = 3,
}

export const enum Climate {
  Cold = 0,
  CoolAndWet = 1,
  HotAndDry = 2,
  Warm = 3,
}

export const DEFAULT_CLIMATE = Climate.Warm;

/** March through October base temperatures, in degrees Celsius. */
const MONTHLY_BASE_TEMPERATURES: readonly (readonly number[])[] = [
  [4, 5, 7, 9, 10, 11, 9, 6],
  [8, 10, 14, 17, 19, 20, 16, 13],
  [12, 14, 16, 19, 21, 22, 21, 16],
  [12, 13, 16, 19, 21, 22, 19, 16],
];

/** Return the base temperature for a March-based month index from 0 through 7. */
export function baseTemperatureForMonth(climate: Climate, month: number): number {
  const row = MONTHLY_BASE_TEMPERATURES[climate];
  if (!row || !Number.isInteger(month) || month < 0 || month >= row.length) {
    throw new RangeError(`Invalid climate month: ${month}`);
  }
  return row[month];
}

/** Temperature adjustments for OpenCoaster's four represented weather kinds. */
export function weatherTemperatureDelta(kind: WeatherKind): number {
  switch (kind) {
    case WeatherKind.Sunny:
      return 10;
    case WeatherKind.Cloudy:
      return 0;
    case WeatherKind.Rain:
      return -2;
    case WeatherKind.Storm:
      return 2;
  }
}

export interface WeatherState {
  climate: Climate;
  kind: WeatherKind;
  /** Degrees Celsius. */
  temperature: number;
  ticksUntilChange: number;
}

export function createWeather(climate = DEFAULT_CLIMATE): WeatherState {
  return {
    climate,
    kind: WeatherKind.Sunny,
    temperature: baseTemperatureForMonth(climate, 0) + weatherTemperatureDelta(WeatherKind.Sunny),
    ticksUntilChange: 4000,
  };
}
