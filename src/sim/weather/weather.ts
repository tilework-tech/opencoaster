export const enum WeatherKind {
  Sunny = 0,
  Cloudy = 1,
  Rain = 2,
  Storm = 3,
}

export interface WeatherState {
  kind: WeatherKind;
  /** Degrees Celsius. */
  temperature: number;
  ticksUntilChange: number;
}

export function createWeather(): WeatherState {
  return { kind: WeatherKind.Sunny, temperature: 20, ticksUntilChange: 4000 };
}
