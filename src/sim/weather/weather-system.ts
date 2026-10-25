import type { System } from '../core/system';
import type { World } from '../core/world';
import { TICKS_PER_MONTH, MONTHS_PER_YEAR } from '../economy/calendar';
import { baseTemperatureForMonth, weatherTemperatureDelta } from './weather';

const MIN_WEATHER_DURATION = 2400;
const WEATHER_DURATION_VARIANCE = 2400;

export function createWeatherSystem(): System {
  return {
    name: 'weather',
    update(world: World) {
      const weather = world.weather;
      if (--weather.ticksUntilChange <= 0) {
        const roll = world.rng.int(3);
        weather.kind = roll >= weather.kind ? roll + 1 : roll;
        weather.ticksUntilChange = MIN_WEATHER_DURATION + world.rng.int(WEATHER_DURATION_VARIANCE);
      }

      const month = Math.floor(world.tick / TICKS_PER_MONTH) % MONTHS_PER_YEAR;
      weather.temperature =
        baseTemperatureForMonth(weather.climate, month) + weatherTemperatureDelta(weather.kind);
    },
  };
}

export const weatherSystem = createWeatherSystem();
