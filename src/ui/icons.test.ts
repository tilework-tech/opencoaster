import { describe, expect, it } from 'vitest';
import { ICON_NAMES, iconArtKind } from './icons';

describe('toolbar icon artwork', () => {
  it('uses vector ride and menu glyphs instead of unrelated queue and save sheet cells', () => {
    expect(iconArtKind('rides')).toBe('vector');
    expect(iconArtKind('menu')).toBe('vector');
    expect(iconArtKind('coaster')).toBe('sprite-sheet');
    expect(iconArtKind('finances')).toBe('sprite-sheet');
  });

  it('classifies every user-interface icon as sheet art or a vector glyph', () => {
    expect(ICON_NAMES.length).toBeGreaterThan(0);
    for (const name of ICON_NAMES) expect(['sprite-sheet', 'vector']).toContain(iconArtKind(name));
  });
});
