import { describe, expect, it } from 'vitest';
import { ElementType, OWNED } from './tile-map';
import {
  isWallScenery,
  placeScenery,
  removeScenery,
  SCENERY_CATALOG,
  SCENERY_GROUPS,
  SceneryCategory,
  SceneryItem,
  sceneryPlacementResult,
  SceneryResult,
} from './scenery';
import { World } from '../core/world';

/** Names and indices of the catalog before the expansion; saves store the index. */
const ORIGINAL = [
  'Oak tree',
  'Conifer',
  'Blossom tree',
  'Shrub',
  'Flower bed',
  'Hedge',
  'Wooden fence',
  'Stone fence',
  'Birch',
  'Autumn tree',
  'Topiary',
  'Palm tree',
  'Cactus',
];

function ownedWorld(): World {
  const world = new World({ seed: 8, width: 12, height: 12 });
  world.map.ownership.fill(0);
  for (const [x, y] of [
    [5, 5],
    [6, 5],
  ] as const) {
    const tile = world.map.index(x, y);
    world.map.ownership[tile] = OWNED;
    world.map.waterLevel[tile] = 0;
  }
  return world;
}

describe('scenery catalog', () => {
  it('keeps the original items at their original indices', () => {
    ORIGINAL.forEach((name, index) => expect(SCENERY_CATALOG[index]!.name).toBe(name));
    expect(SceneryItem.CactusTree).toBe(12);
  });

  it('adds at least twelve distinct decorations', () => {
    expect(SCENERY_CATALOG.length - ORIGINAL.length).toBeGreaterThanOrEqual(12);
    const added = SCENERY_CATALOG.slice(ORIGINAL.length);
    expect(new Set(added.map((item) => item.name)).size).toBe(added.length);
    expect(new Set(added.map((item) => item.sprite)).size).toBe(added.length);
  });

  it('gives every item a unique name, sprite, price, height and description', () => {
    expect(new Set(SCENERY_CATALOG.map((item) => item.name)).size).toBe(SCENERY_CATALOG.length);
    expect(new Set(SCENERY_CATALOG.map((item) => item.sprite)).size).toBe(SCENERY_CATALOG.length);
    for (const item of SCENERY_CATALOG) {
      expect(item.priceCents).toBeGreaterThan(0);
      expect(item.removalPriceCents).toBeGreaterThanOrEqual(0);
      expect(item.removalPriceCents).toBeLessThanOrEqual(item.priceCents);
      expect(item.height).toBeGreaterThanOrEqual(1);
      expect(item.width).toBeGreaterThan(0);
      expect(item.blurb.length).toBeGreaterThan(10);
    }
  });

  it('spreads the additions over planting, rocks, fountains and statues, and themed decor', () => {
    const added = SCENERY_CATALOG.slice(ORIGINAL.length);
    const count = (category: SceneryCategory): number =>
      added.filter((item) => item.category === category).length;
    expect(count(SceneryCategory.Gardens)).toBeGreaterThanOrEqual(3);
    expect(count(SceneryCategory.Rocks)).toBeGreaterThanOrEqual(3);
    expect(count(SceneryCategory.Features)).toBeGreaterThanOrEqual(3);
    expect(count(SceneryCategory.Themed)).toBeGreaterThanOrEqual(3);
  });

  it('lists every item in exactly one browse group, and no group is empty', () => {
    for (const item of SCENERY_CATALOG)
      expect(SCENERY_GROUPS.filter((group) => group.category === item.category)).toHaveLength(1);
    for (const group of SCENERY_GROUPS)
      expect(SCENERY_CATALOG.some((item) => item.category === group.category)).toBe(true);
  });

  it('draws every new decoration from its own four-view model at native size', () => {
    for (const item of SCENERY_CATALOG.slice(ORIGINAL.length)) {
      expect(item.native).toBe(true);
      expect(isWallScenery(SCENERY_CATALOG.indexOf(item))).toBe(false);
    }
  });

  it('does not describe decorations as functional facilities', () => {
    for (const item of SCENERY_CATALOG.slice(ORIGINAL.length))
      expect(item.blurb).not.toMatch(
        /\b(guests? (use|rest|sit|buy|drink)|restores?|heals?|refill)/i,
      );
  });
});

describe('placing the added scenery', () => {
  const added = SCENERY_CATALOG.map((_, index) => index).slice(ORIGINAL.length);

  it.each(added)('places, blocks a second piece, and removes item %i', (item) => {
    const world = ownedWorld();
    const map = world.map;
    expect(sceneryPlacementResult(map, 5, 5, item)).toBe(SceneryResult.Ok);
    expect(placeScenery(map, 5, 5, item, 2)).toBe(true);
    const element = map.firstElement(map.index(5, 5));
    expect(map.elType[element]).toBe(ElementType.SmallScenery);
    expect(map.elData[element]).toBe(item);
    expect(map.elFlags[element]).toBe(2);
    expect(map.elClear[element] - map.elBase[element]).toBe(SCENERY_CATALOG[item]!.height);
    expect(sceneryPlacementResult(map, 5, 5, item)).toBe(SceneryResult.Blocked);
    expect(sceneryPlacementResult(map, 6, 5, item)).toBe(SceneryResult.Ok);
    expect(removeScenery(map, 5, 5)).toBe(item);
    expect(map.firstElement(map.index(5, 5))).toBe(-1);
  });

  it.each(added)('refuses item %i on unowned land and under water', (item) => {
    const world = ownedWorld();
    const map = world.map;
    expect(sceneryPlacementResult(map, 3, 3, item)).toBe(SceneryResult.NotOwned);
    const tile = map.index(6, 5);
    map.waterLevel[tile] = map.heights[tile] + 1;
    expect(sceneryPlacementResult(map, 6, 5, item)).toBe(SceneryResult.Underwater);
  });

  it('refuses a rotation outside the four quarter turns', () => {
    const world = ownedWorld();
    expect(sceneryPlacementResult(world.map, 5, 5, SceneryItem.Boulder, 4)).toBe(
      SceneryResult.Invalid,
    );
  });
});
