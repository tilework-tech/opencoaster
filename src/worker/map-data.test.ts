import { describe, expect, it } from 'vitest';
import { OWNED, ElementType, PathFlag } from '../sim/map/tile-map';
import { placePath, PathAddition, setPathAddition } from '../sim/map/paths';
import { World } from '../sim/core/world';
import { extractMapData } from './map-data';

describe('map render data', () => {
  it('copies water heights and path stack levels and additions for the renderer', () => {
    const world = new World({ seed: 3, width: 8, height: 8 });
    world.map.ownership.fill(OWNED);
    expect(placePath(world.map, { x: 3, y: 4, z: 8, slope: 0, queue: true })).toBe(true);
    expect(setPathAddition(world.map, 3, 4, PathAddition.Bin)).toBe(true);
    const tile = world.map.index(2, 2);
    world.map.waterLevel[tile] = 10;

    const data = extractMapData(world.map);
    const pathIndex = world.map.firstElement(world.map.index(3, 4));

    expect(data.waterLevel[tile]).toBe(10);
    expect(data.pathCount).toBe(1);
    expect(Array.from(data.pathElements.slice(0, 5))).toEqual([
      3,
      4,
      8,
      world.map.elFlags[pathIndex],
      0,
    ]);
    expect(world.map.elType[pathIndex]).toBe(ElementType.Path);
    expect(data.pathElements[3] & (PathFlag.Queue | PathFlag.Bin)).toBe(
      PathFlag.Queue | PathFlag.Bin,
    );
  });
});
