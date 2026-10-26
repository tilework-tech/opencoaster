import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  parseSettings,
  saveSettings,
  SETTINGS_KEY,
} from './settings';

describe('player settings', () => {
  it('restores the speed and pause state that were saved', () => {
    expect(parseSettings(JSON.stringify({ speed: 4, paused: true }))).toEqual({
      speed: 4,
      paused: true,
      soundVolume: 1,
      musicVolume: 0.7,
      musicOn: true,
      muted: false,
      messageFilter: { award: true, ride: true, park: true, guest: true },
    });
  });

  it('restores the music on/off choice that was saved', () => {
    expect(parseSettings(JSON.stringify({ musicOn: false })).musicOn).toBe(false);
    expect(parseSettings(JSON.stringify({ musicOn: 'no' })).musicOn).toBe(true);
  });

  it('defaults missing message categories on while preserving saved choices', () => {
    expect(
      parseSettings(JSON.stringify({ messageFilter: { guest: false, marketing: false } }))
        .messageFilter,
    ).toEqual({ award: true, ride: true, park: true, guest: false });
  });

  it('falls back to defaults when nothing is saved', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('ignores a saved value that is not valid JSON or has an unknown speed', () => {
    expect(parseSettings('{not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(JSON.stringify({ speed: 3, paused: true }))).toEqual({
      ...DEFAULT_SETTINGS,
      speed: DEFAULT_SETTINGS.speed,
      paused: true,
    });
    expect(parseSettings(JSON.stringify({ speed: 2, paused: 'yes' }))).toEqual({
      ...DEFAULT_SETTINGS,
      speed: 2,
      paused: DEFAULT_SETTINGS.paused,
    });
  });

  it('clamps invalid audio levels and restores mute independently', () => {
    expect(
      parseSettings(JSON.stringify({ soundVolume: 2, musicVolume: -1, muted: true })),
    ).toMatchObject({
      soundVolume: 1,
      musicVolume: 0,
      muted: true,
    });
  });

  it('persists sound levels and mute with the other player preferences', () => {
    const values = new Map<string, string>();
    const storage = {
      get length() {
        return values.size;
      },
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
    } satisfies Storage;
    const settings = { ...DEFAULT_SETTINGS, soundVolume: 0.35, musicVolume: 0.9, muted: true };
    saveSettings(settings, storage);
    expect(loadSettings(storage)).toEqual(settings);
  });

  it('uses a versioned storage key', () => {
    expect(SETTINGS_KEY).toMatch(/v1$/);
  });
});
