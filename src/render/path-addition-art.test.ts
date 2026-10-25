import { describe, expect, it } from 'vitest';
import { PathFlag, PATH_ADDITION_BROKEN } from '../sim/map/tile-map';
import { litterSpriteName, pathAdditionSpriteName } from './world-art';

describe('path addition art', () => {
  it('selects a separate damaged sprite for vandalised benches and bins', () => {
    expect(pathAdditionSpriteName(PathFlag.Bench, 2, PATH_ADDITION_BROKEN)).toBe(
      'scenery/bench-broken/view-2',
    );
    expect(pathAdditionSpriteName(PathFlag.Bin, 3, PATH_ADDITION_BROKEN)).toBe(
      'scenery/bin-broken/view-3',
    );
    expect(pathAdditionSpriteName(PathFlag.Lamp, 1, PATH_ADDITION_BROKEN)).toBe(
      'scenery/lamp-broken/view-1',
    );
  });

  it('uses authored world props for benches, bins, lamps, and roofed shelters', () => {
    for (let rotation = 0; rotation < 4; rotation++) {
      expect(pathAdditionSpriteName(PathFlag.Bench, rotation, 0)).toBe('scenery/bench');
      expect(pathAdditionSpriteName(PathFlag.Bin, rotation, 0)).toBe('scenery/bin');
      expect(pathAdditionSpriteName(PathFlag.Lamp, rotation, 0)).toBe('scenery/lamp');
      expect(pathAdditionSpriteName(PathFlag.Shelter, rotation, 0)).toBe(
        `scenery/shelter/view-${rotation}`,
      );
    }
  });
});

describe('litter art', () => {
  it('maps each simulated litter kind to its own authored sprite', () => {
    for (let rotation = 0; rotation < 4; rotation++) {
      expect(litterSpriteName(0, rotation)).toBe(`litter/trash/view-${rotation}`);
      expect(litterSpriteName(1, rotation)).toBe(`litter/vomit/view-${rotation}`);
    }
  });
});
