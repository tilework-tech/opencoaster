import { GAME_SPEEDS } from './settings';

/** Default keyboard shortcuts of the park view. Pure: maps a key event to an action. */

export type ShortcutAction =
  | { type: 'closeTop' }
  | { type: 'closeAll' }
  | { type: 'cancel' }
  | { type: 'pause' }
  | { type: 'speed'; speed: number }
  | { type: 'speedStep'; direction: -1 | 1 }
  | { type: 'dismissMessage' }
  | { type: 'rotate'; direction: -1 | 1 }
  | { type: 'rotatePiece' }
  | { type: 'zoom'; direction: -1 | 1 }
  | { type: 'window'; id: string };

export interface KeyLike {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

const WINDOW_KEYS: Readonly<Record<string, string>> = {
  F1: 'land',
  F2: 'water',
  F3: 'scenery',
  F4: 'paths',
  F5: 'ride-select',
  f: 'finance',
  d: 'research',
  r: 'ride-list',
  p: 'park',
  g: 'guests',
  s: 'staff',
  m: 'news',
  Tab: 'map',
};

const SPEED_KEYS: readonly string[] = GAME_SPEEDS.map(String);

export function shortcutFor(event: KeyLike): ShortcutAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (SPEED_KEYS.includes(event.key)) return { type: 'speed', speed: Number(event.key) };
  if (event.key === '+' || event.key === '=') return { type: 'speedStep', direction: 1 };
  if (event.key === '-') return { type: 'speedStep', direction: -1 };
  switch (event.key) {
    case 'Backspace':
      return { type: event.shiftKey ? 'closeAll' : 'closeTop' };
    case 'Escape':
      return { type: 'cancel' };
    case 'Enter':
      return { type: 'rotate', direction: event.shiftKey ? -1 : 1 };
    case 't':
      return { type: 'rotatePiece' };
    case 'PageUp':
      return { type: 'zoom', direction: -1 };
    case 'PageDown':
      return { type: 'zoom', direction: 1 };
    case ' ':
    case 'Pause':
      return { type: 'pause' };
  }
  if (event.key.toLowerCase() === 'q') return { type: 'dismissMessage' };
  if (event.key.toLowerCase() === 'z') return { type: 'rotate', direction: 1 };
  if (event.key.toLowerCase() === 'x') return { type: 'rotate', direction: -1 };
  const id = WINDOW_KEYS[event.key] ?? WINDOW_KEYS[event.key.toLowerCase()];
  return id ? { type: 'window', id } : null;
}
