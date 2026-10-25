import { describe, expect, it } from 'vitest';
import { OWNED, ElementType } from './tile-map';
import { placeScenery, SceneryItem } from './scenery';
import { World } from '../core/world';

describe('place scenery', () => {
  it('places a catalog item as a map element on owned dry land', () => {
    const world = new World({ seed: 8, width: 12, height: 12 });
    const map = world.map;
    map.ownership.fill(0);
    const tile = map.index(5, 5);
    map.ownership[tile] = OWNED;
    map.waterLevel[tile] = 0;
    const before = map.elementCount;
    expect(placeScenery(map, 5, 5, SceneryItem.OakTree)).toBe(true);
    expect(map.elementCount).toBe(before + 1);
    const element = map.firstElement(tile);
    expect(map.elType[element]).toBe(ElementType.SmallScenery);
    expect(map.elData[element]).toBe(SceneryItem.OakTree);
  });

  it('rejects scenery placement on unowned tiles and under water', () => {
    const world = new World({ seed: 8, width: 12, height: 12 });
    const map = world.map;
    map.ownership.fill(0);
    expect(placeScenery(map, 5, 5, SceneryItem.Shrub)).toBe(false);
    const tile = map.index(6, 5);
    map.ownership[tile] = OWNED;
    map.waterLevel[tile] = map.heights[tile] + 1;
    expect(placeScenery(map, 6, 5, SceneryItem.Shrub)).toBe(false);
  });

  it('stores a two-level clearance for stone fencing', () => {
    const world = new World({ seed: 8, width: 12, height: 12 });
    const map = world.map;
    map.ownership.fill(0);
    const tile = map.index(5, 5);
    map.ownership[tile] = OWNED;

    expect(placeScenery(map, 5, 5, SceneryItem.StoneFence)).toBe(true);
    const element = map.firstElement(tile);
    expect(map.elClear[element] - map.elBase[element]).toBe(2);
  });
});
