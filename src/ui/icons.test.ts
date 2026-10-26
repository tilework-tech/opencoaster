import { describe, expect, it } from 'vitest';
import { ICON_NAMES, iconArtKind, iconAssetPath } from './icons';

describe('UI icon artwork', () => {
  it('provides original pixel art for every icon id in the interface', () => {
    expect(ICON_NAMES.length).toBeGreaterThan(0);
    expect(ICON_NAMES.map(iconArtKind)).toEqual(ICON_NAMES.map(() => 'pixel-art'));
    for (const name of ICON_NAMES) {
      expect(iconAssetPath(name, 16), name).toBe(`/sprites/ui-icons/16/${name}.png`);
      expect(iconAssetPath(name, 24), name).toBe(`/sprites/ui-icons/24/${name}.png`);
    }
  });
});
