import { describe, expect, it } from 'vitest';
import { hashWorld } from '../core/hash';
import { World } from '../core/world';
import { weatherSystem } from './weather-system';
import {
  Climate,
  createWeather,
  DEFAULT_CLIMATE,
  WeatherKind,
  baseTemperatureForMonth,
} from './weather';

describe('weather', () => {
  it('uses the climate base temperature for each March-to-October month', () => {
    const expected = [
      [4, 5, 7, 9, 10, 11, 9, 6],
      [8, 10, 14, 17, 19, 20, 16, 13],
      [12, 14, 16, 19, 21, 22, 21, 16],
      [12, 13, 16, 19, 21, 22, 19, 16],
    ];
    const climates = [Climate.Cold, Climate.CoolAndWet, Climate.HotAndDry, Climate.Warm];

    for (let climateIndex = 0; climateIndex < climates.length; climateIndex++) {
      for (let month = 0; month < 8; month++) {
        expect(baseTemperatureForMonth(climates[climateIndex], month)).toBe(
          expected[climateIndex][month],
        );
      }
    }
  });

  it('derives temperature from the climate month and current weather kind', () => {
    const world = new World({ seed: 13, width: 16, height: 16 });
    world.weather.climate = Climate.Cold;
    world.weather.kind = WeatherKind.Rain;
    world.weather.ticksUntilChange = 10;

    weatherSystem.update(world);

    expect(world.weather.temperature).toBe(2);

    world.tick = 2 * 16_384;
    weatherSystem.update(world);

    expect(world.weather.temperature).toBe(5);
  });

  it('applies the documented temperature adjustment for each represented weather kind', () => {
    const expected = [14, 4, 2, 6];
    const world = new World({ seed: 13, width: 16, height: 16 });
    world.weather.climate = Climate.Cold;
    world.weather.ticksUntilChange = 10;

    for (const [index, kind] of [
      WeatherKind.Sunny,
      WeatherKind.Cloudy,
      WeatherKind.Rain,
      WeatherKind.Storm,
    ].entries()) {
      world.weather.kind = kind;
      weatherSystem.update(world);
      expect(world.weather.temperature).toBe(expected[index]);
    }
  });

  it('starts in the named default climate with its March sunny temperature', () => {
    expect(createWeather().climate).toBe(DEFAULT_CLIMATE);
    expect(createWeather().temperature).toBe(22);
  });

  it('transitions deterministically and contributes to the world hash', () => {
    const first = new World({ seed: 13, width: 16, height: 16 });
    const second = new World({ seed: 13, width: 16, height: 16 });
    first.weather.ticksUntilChange = 1;
    second.weather.ticksUntilChange = 1;
    const before = hashWorld(first);

    weatherSystem.update(first);
    weatherSystem.update(second);

    expect(first.weather).toEqual(second.weather);
    expect(first.weather.kind).not.toBe(WeatherKind.Sunny);
    expect(hashWorld(first)).not.toBe(before);

    for (const key of ['climate', 'kind', 'temperature', 'ticksUntilChange'] as const) {
      const changedWeather = new World({ seed: 13, width: 16, height: 16 });
      changedWeather.weather[key]++;
      expect(hashWorld(changedWeather)).not.toBe(
        hashWorld(new World({ seed: 13, width: 16, height: 16 })),
      );
    }
  });
});
