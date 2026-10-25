export const SETTINGS_KEY = 'opencoaster.settings.v1';

export const GAME_SPEEDS = [1, 2, 4] as const;
export type GameSpeed = (typeof GAME_SPEEDS)[number];

/** Player preferences kept across reloads. Not part of the save: they belong to the browser. */
export interface PlayerSettings {
  speed: GameSpeed;
  paused: boolean;
  soundVolume: number;
  musicVolume: number;
  muted: boolean;
}

export const DEFAULT_SETTINGS: PlayerSettings = {
  speed: 1,
  paused: false,
  soundVolume: 1,
  musicVolume: 0.7,
  muted: false,
};

function volume(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}

/** Reads saved settings, keeping each field that is valid and defaulting the rest. */
export function parseSettings(raw: string | null): PlayerSettings {
  if (raw === null) return { ...DEFAULT_SETTINGS };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_SETTINGS };
  const record = value as Record<string, unknown>;
  return {
    speed: (GAME_SPEEDS as readonly unknown[]).includes(record.speed)
      ? (record.speed as GameSpeed)
      : DEFAULT_SETTINGS.speed,
    paused: typeof record.paused === 'boolean' ? record.paused : DEFAULT_SETTINGS.paused,
    soundVolume: volume(record.soundVolume, DEFAULT_SETTINGS.soundVolume),
    musicVolume: volume(record.musicVolume, DEFAULT_SETTINGS.musicVolume),
    muted: typeof record.muted === 'boolean' ? record.muted : DEFAULT_SETTINGS.muted,
  };
}

export function loadSettings(storage: Storage = localStorage): PlayerSettings {
  return parseSettings(storage.getItem(SETTINGS_KEY));
}

export function saveSettings(settings: PlayerSettings, storage: Storage = localStorage): void {
  storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
