import { describe, expect, it } from 'vitest';
import { flatWorld, layPath, row } from '../sim/integration/fixtures';
import { PathAddition, setPathAddition } from '../sim/map/paths';
import { isPathElementBroken, markPathElementBroken } from '../sim/map/tile-map';
import { TICKS_PER_MONTH } from '../sim/economy/calendar';
import { darknessAt, lampsLit } from '../render/night-lighting';
import { deserialize, serialize } from './save';

describe('night lighting across a save', () => {
  it('restores the time of day and which lamps are broken', () => {
    const world = flatWorld(12);
    layPath(world, row(5, 3, 8));
    expect(setPathAddition(world.map, 4, 5, PathAddition.Lamp)).toBe(true);
    expect(setPathAddition(world.map, 6, 5, PathAddition.Lamp)).toBe(true);
    markPathElementBroken(world.map, world.map.pathElement(world.map.index(6, 5), -1));
    world.tick = Math.round(((16 / 24) * TICKS_PER_MONTH) / 31) + 3 * TICKS_PER_MONTH;

    const restored = deserialize(serialize(world));

    expect(restored.tick).toBe(world.tick);
    expect(darknessAt(restored.tick)).toBe(darknessAt(world.tick));
    expect(lampsLit(darknessAt(restored.tick))).toBe(true);
    const broken = (x: number) =>
      isPathElementBroken(restored.map, restored.map.pathElement(restored.map.index(x, 5), -1));
    expect(broken(4)).toBe(false);
    expect(broken(6)).toBe(true);
  });
});
