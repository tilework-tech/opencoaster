import { describe, expect, it } from 'vitest';
import { shortcutFor } from './shortcuts';

const key = (
  k: string,
  extra: Partial<{ shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {},
) =>
  shortcutFor({ key: k, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...extra });

describe('default shortcuts', () => {
  it('closes the topmost window on Backspace and every window on Shift+Backspace', () => {
    expect(key('Backspace')).toEqual({ type: 'closeTop' });
    expect(key('Backspace', { shiftKey: true })).toEqual({ type: 'closeAll' });
  });

  it('cancels construction on Escape and rotates clockwise on Enter or Z', () => {
    expect(key('Escape')).toEqual({ type: 'cancel' });
    expect(key('Enter')).toEqual({ type: 'rotate', direction: 1 });
    expect(key('z')).toEqual({ type: 'rotate', direction: 1 });
  });

  it('rotates anticlockwise on Shift+Enter or X', () => {
    expect(key('Enter', { shiftKey: true })).toEqual({ type: 'rotate', direction: -1 });
    expect(key('x')).toEqual({ type: 'rotate', direction: -1 });
  });

  it('rotates the piece being placed on T', () => {
    expect(key('t')).toEqual({ type: 'rotatePiece' });
  });

  it('zooms one step with Page Up (out) and Page Down (in)', () => {
    expect(key('PageUp')).toEqual({ type: 'zoom', direction: -1 });
    expect(key('PageDown')).toEqual({ type: 'zoom', direction: 1 });
  });

  it('opens construction windows from F1-F5', () => {
    expect(['F1', 'F2', 'F3', 'F4', 'F5'].map((k) => key(k))).toEqual([
      { type: 'window', id: 'land' },
      { type: 'window', id: 'water' },
      { type: 'window', id: 'scenery' },
      { type: 'window', id: 'paths' },
      { type: 'window', id: 'ride-select' },
    ]);
  });

  it('opens management windows from letter keys, case-insensitively', () => {
    expect(['f', 'D', 'r', 'p', 'g', 's', 'm', 'Tab'].map((k) => key(k))).toEqual([
      { type: 'window', id: 'finance' },
      { type: 'window', id: 'research' },
      { type: 'window', id: 'ride-list' },
      { type: 'window', id: 'park' },
      { type: 'window', id: 'guests' },
      { type: 'window', id: 'staff' },
      { type: 'window', id: 'news' },
      { type: 'window', id: 'map' },
    ]);
  });

  it('toggles pause on Space and Pause', () => {
    expect(key(' ')).toEqual({ type: 'pause' });
    expect(key('Pause')).toEqual({ type: 'pause' });
  });

  it('ignores browser shortcuts with modifiers', () => {
    expect(key('r', { ctrlKey: true })).toBeNull();
    expect(key('p', { metaKey: true })).toBeNull();
  });
});
