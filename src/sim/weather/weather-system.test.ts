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

  it('keeps wet weather occasional and clear spells substantially longer across seeds', () => {
    const seedCount = 16;
    const ticksPerSeed = 400_000;
    let wetTicks = 0;
    let totalTicks = 0;
    let wetStarts = 0;
    let wetSpellTicks = 0;
    let clearSpellTicks = 0;
    let wetSpellCount = 0;
    let clearSpellCount = 0;

    for (let seed = 1; seed <= seedCount; seed++) {
      const world = new World({ seed, width: 16, height: 16 });
      let wasWet = world.weather.kind >= WeatherKind.Rain;
      let wetRun = 0;
      let clearRun = 0;

      for (let tick = 0; tick < ticksPerSeed; tick++) {
        weatherSystem.update(world);
        const isWet = world.weather.kind >= WeatherKind.Rain;
        totalTicks++;
        if (isWet) {
          wetTicks++;
          wetRun++;
          if (!wasWet) {
            wetStarts++;
            clearSpellTicks += clearRun;
            clearSpellCount++;
            clearRun = 0;
          }
        } else {
          clearRun++;
          if (wasWet) {
            wetSpellTicks += wetRun;
            wetSpellCount++;
            wetRun = 0;
          }
        }
        wasWet = isWet;
      }
    }

    const hours = totalTicks / 40 / 3600;
    expect(wetTicks / totalTicks).toBeGreaterThanOrEqual(0.21);
    expect(wetTicks / totalTicks).toBeLessThanOrEqual(0.29);
    expect(wetStarts / hours).toBeGreaterThanOrEqual(5);
    expect(wetStarts / hours).toBeLessThanOrEqual(8);
    expect(wetSpellTicks / wetSpellCount / 40).toBeGreaterThanOrEqual(110);
    expect(wetSpellTicks / wetSpellCount / 40).toBeLessThanOrEqual(160);
    expect(clearSpellTicks / clearSpellCount / 40).toBeGreaterThanOrEqual(330);
    expect(clearSpellTicks / clearSpellCount / 40).toBeLessThanOrEqual(480);
  });

  it('produces the same multi-transition weather trace from the same seed', () => {
    const trace = (seed: number) => {
      const world = new World({ seed, width: 16, height: 16 });
      const changes: Array<[WeatherKind, number]> = [];
      let previous = world.weather.kind;
      for (let tick = 0; tick < 300_000 && changes.length < 120; tick++) {
        weatherSystem.update(world);
        if (world.weather.kind !== previous) {
          changes.push([world.weather.kind, world.weather.ticksUntilChange]);
          previous = world.weather.kind;
        }
      }
      return changes;
    };

    expect(trace(817)).toEqual(trace(817));
  });
});
