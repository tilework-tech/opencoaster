import type { System } from '../core/system';
import type { World } from '../core/world';
import { WeatherKind } from './weather';

const MIN_WEATHER_DURATION = 2400;
const WEATHER_DURATION_VARIANCE = 2400;

export function createWeatherSystem(): System {
  return {
    name: 'weather',
    update(world: World) {
      const weather = world.weather;
      if (--weather.ticksUntilChange > 0) return;
      const roll = world.rng.int(3);
      weather.kind = roll >= weather.kind ? roll + 1 : roll;
      weather.temperature =
        weather.kind === WeatherKind.Storm
          ? 12
          : weather.kind === WeatherKind.Rain
            ? 15
            : 18 + world.rng.int(10);
      weather.ticksUntilChange = MIN_WEATHER_DURATION + world.rng.int(WEATHER_DURATION_VARIANCE);
    },
  };
}

export const weatherSystem = createWeatherSystem();
