import { describe, expect, it } from 'vitest';
import { OWNED, ElementType } from './tile-map';
import { placeScenery, SceneryItem, sceneryPlacementResult, SceneryResult } from './scenery';
import { World } from '../core/world';
import { TileMapPathGraph } from '../pathfinding/graph';
import { layPath } from '../integration/fixtures';

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

describe('scenery placement result', () => {
  it('reports why a tile refuses scenery without changing the map', () => {
    const world = new World({ seed: 8, width: 12, height: 12 });
    const map = world.map;
    map.ownership.fill(0);
    const owned = map.index(5, 5);
    map.ownership[owned] = OWNED;
    const before = map.elementCount;

    expect(sceneryPlacementResult(map, 5, 5, SceneryItem.Shrub)).toBe(SceneryResult.Ok);
    expect(sceneryPlacementResult(map, 6, 6, SceneryItem.Shrub)).toBe(SceneryResult.NotOwned);
    expect(sceneryPlacementResult(map, 99, 0, SceneryItem.Shrub)).toBe(SceneryResult.Invalid);
    expect(sceneryPlacementResult(map, 5, 5, SceneryItem.Shrub, 4)).toBe(SceneryResult.Invalid);
    map.waterLevel[owned] = map.heights[owned] + 1;
    expect(sceneryPlacementResult(map, 5, 5, SceneryItem.Shrub)).toBe(SceneryResult.Underwater);
    map.waterLevel[owned] = 0;
    expect(placeScenery(map, 5, 5, SceneryItem.Shrub)).toBe(true);
    expect(sceneryPlacementResult(map, 5, 5, SceneryItem.Shrub)).toBe(SceneryResult.Blocked);
    expect(map.elementCount).toBe(before + 1);
  });

  it('stores the rotation the piece was placed with', () => {
    const world = new World({ seed: 8, width: 12, height: 12 });
    const map = world.map;
    map.ownership.fill(0);
    const tile = map.index(4, 4);
    map.ownership[tile] = OWNED;
    expect(placeScenery(map, 4, 4, SceneryItem.WoodenFence, 3)).toBe(true);
    expect(map.elFlags[map.firstElement(tile)]).toBe(3);
  });

  it('stores four walls on separate edges of one tile and rejects a duplicate edge', () => {
    const world = new World({ seed: 8, width: 12, height: 12 });
    const map = world.map;
    map.ownership.fill(0);
    map.ownership[map.index(4, 4)] = OWNED;

    expect([0, 1, 2, 3].map((edge) => placeScenery(map, 4, 4, SceneryItem.WoodenFence, edge))).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(placeScenery(map, 4, 4, SceneryItem.StoneFence, 2)).toBe(false);
    const flags: number[] = [];
    for (let element = map.firstElement(map.index(4, 4)); element >= 0; element = map.nextElement(element))
      if (map.elType[element] === ElementType.SmallScenery) flags.push(map.elFlags[element]!);
    expect(flags.sort()).toEqual([0, 1, 2, 3]);
  });

  it('blocks path movement only across the wall edge', () => {
    const world = new World({ seed: 8, width: 12, height: 12 });
    const map = world.map;
    map.ownership.fill(0);
    const tile = map.index(4, 4);
    map.ownership[tile] = OWNED;
    map.ownership[tile + 1] = OWNED;
    map.ownership[tile + map.width] = OWNED;
    layPath(world, [[4, 4], [5, 4], [4, 5]]);
    expect(placeScenery(map, 4, 4, SceneryItem.Hedge, 0)).toBe(true);

    const graph = new TileMapPathGraph(map);
    expect(graph.edgeMask(tile) & 1).toBe(0);
    expect(graph.edgeMask(tile) & 2).toBe(2);
    expect(graph.edgeMask(tile + 1) & 4).toBe(0);
  });
});
