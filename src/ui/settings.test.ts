import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings, SETTINGS_KEY } from './settings';

describe('player settings', () => {
  it('restores the speed and pause state that were saved', () => {
    expect(parseSettings(JSON.stringify({ speed: 4, paused: true }))).toEqual({
      speed: 4,
      paused: true,
    });
  });

  it('falls back to defaults when nothing is saved', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('ignores a saved value that is not valid JSON or has an unknown speed', () => {
    expect(parseSettings('{not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(JSON.stringify({ speed: 3, paused: true }))).toEqual({
      speed: DEFAULT_SETTINGS.speed,
      paused: true,
    });
    expect(parseSettings(JSON.stringify({ speed: 2, paused: 'yes' }))).toEqual({
      speed: 2,
      paused: DEFAULT_SETTINGS.paused,
    });
  });

  it('uses a versioned storage key', () => {
    expect(SETTINGS_KEY).toMatch(/v1$/);
  });
});
