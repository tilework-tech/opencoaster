import type { System } from '../core/system';
import type { World } from '../core/world';
import { TICKS_PER_MONTH, MONTHS_PER_YEAR } from '../economy/calendar';
import { WeatherKind, baseTemperatureForMonth, weatherTemperatureDelta } from './weather';

const MIN_WEATHER_DURATION = 2400;
const WEATHER_DURATION_VARIANCE = 2400;

export function createWeatherSystem(): System {
  return {
    name: 'weather',
    update(world: World) {
      const weather = world.weather;
      if (--weather.ticksUntilChange <= 0) {
        const roll = world.rng.int(9);
        switch (weather.kind) {
          case WeatherKind.Sunny:
            weather.kind =
              roll < 7 ? WeatherKind.Cloudy : roll === 7 ? WeatherKind.Rain : WeatherKind.Storm;
            break;
          case WeatherKind.Cloudy:
            weather.kind =
              roll < 7 ? WeatherKind.Sunny : roll === 7 ? WeatherKind.Rain : WeatherKind.Storm;
            break;
          case WeatherKind.Rain:
            weather.kind =
              roll < 3 ? WeatherKind.Sunny : roll < 6 ? WeatherKind.Cloudy : WeatherKind.Storm;
            break;
          case WeatherKind.Storm:
            weather.kind =
              roll < 3 ? WeatherKind.Sunny : roll < 6 ? WeatherKind.Cloudy : WeatherKind.Rain;
            break;
        }
        weather.ticksUntilChange = MIN_WEATHER_DURATION + world.rng.int(WEATHER_DURATION_VARIANCE);
      }

      const month = Math.floor(world.tick / TICKS_PER_MONTH) % MONTHS_PER_YEAR;
      weather.temperature =
        baseTemperatureForMonth(weather.climate, month) + weatherTemperatureDelta(weather.kind);
    },
  };
}

export const weatherSystem = createWeatherSystem();
