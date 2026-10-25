/** Default keyboard shortcuts of the park view. Pure: maps a key event to an action. */

export type ShortcutAction =
  | { type: 'closeTop' }
  | { type: 'closeAll' }
  | { type: 'cancel' }
  | { type: 'pause' }
  | { type: 'rotate'; direction: -1 | 1 }
  | { type: 'rotatePiece' }
  | { type: 'rotateConstruction' }
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

export function shortcutFor(event: KeyLike): ShortcutAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
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
    case 'z':
    case 'Z':
      return { type: 'rotateConstruction' };
    case ' ':
    case 'Pause':
      return { type: 'pause' };
  }
  if (event.key.toLowerCase() === 'z') return { type: 'rotate', direction: 1 };
  if (event.key.toLowerCase() === 'x') return { type: 'rotate', direction: -1 };
  const id = WINDOW_KEYS[event.key] ?? WINDOW_KEYS[event.key.toLowerCase()];
  return id ? { type: 'window', id } : null;
}
