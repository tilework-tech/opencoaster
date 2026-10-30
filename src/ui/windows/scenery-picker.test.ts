import { describe, expect, it } from 'vitest';
import { SCENERY_CATALOG, SCENERY_GROUPS, SceneryItem } from '../../sim/map/scenery';
import {
  sceneryInGroup,
  sceneryRotates,
  sceneryThumbnailKey,
  sceneryTooltip,
} from './scenery-picker';

describe('scenery picker', () => {
  it('offers every catalog item exactly once across the groups', () => {
    const offered = SCENERY_GROUPS.flatMap((group) => sceneryInGroup(group.category)).map(
      (entry) => entry.index,
    );
    expect(offered.sort((a, b) => a - b)).toEqual(SCENERY_CATALOG.map((_, index) => index));
  });

  it('keeps each group small enough to browse at a glance', () => {
    for (const group of SCENERY_GROUPS)
      expect(sceneryInGroup(group.category).length, group.label).toBeLessThanOrEqual(8);
  });

  it('shows name, price and description in the tooltip', () => {
    expect(sceneryTooltip(SCENERY_CATALOG[SceneryItem.Boulder]!)).toBe(
      'Boulder, $1.00. One large weathered boulder.',
    );
  });

  it('pictures every item with an atlas key it is drawn from', () => {
    for (const definition of SCENERY_CATALOG) {
      const key = sceneryThumbnailKey(definition, 0);
      expect(key).toMatch(/^(trees|scenery)\//);
      if (definition.native) expect(key).toBe(`scenery/${definition.sprite}/view-0`);
    }
  });

  it('enables Rotate only for walls and directional pieces', () => {
    expect(sceneryRotates(SceneryItem.WoodenFence)).toBe(true);
    expect(sceneryRotates(SceneryItem.GardenStatue)).toBe(true);
    expect(sceneryRotates(SceneryItem.Boulder)).toBe(false);
    expect(sceneryRotates(SceneryItem.OakTree)).toBe(false);
  });
});
