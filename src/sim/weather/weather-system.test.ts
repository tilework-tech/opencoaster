import { describe, expect, it } from 'vitest';
import { hashWorld } from '../core/hash';
import { World } from '../core/world';
import { weatherSystem } from './weather-system';
import { WeatherKind } from './weather';

describe('weather', () => {
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

    for (const key of ['kind', 'temperature', 'ticksUntilChange'] as const) {
      const changedWeather = new World({ seed: 13, width: 16, height: 16 });
      changedWeather.weather[key]++;
      expect(hashWorld(changedWeather)).not.toBe(
        hashWorld(new World({ seed: 13, width: 16, height: 16 })),
      );
    }
  });
});
