import { describe, expect, it } from 'vitest';
import { hashWorld } from '../src/sim/core/hash';
import { ElementType, PathFlag } from '../src/sim/map/tile-map';
import { createBenchScenario } from './scenario';

describe('benchmark scenario', () => {
  it('builds a repeatable park with the requested guests, staff, litter, and usable bins', () => {
    const first = createBenchScenario({ guests: 8, staff: 4, litter: 12 });
    const second = createBenchScenario({ guests: 8, staff: 4, litter: 12 });
    first.step();
    second.step();

    expect(first.world.guests.count).toBe(8);
    expect(first.world.staff.count).toBe(4);
    expect(first.world.litter.count).toBe(12);
    const map = first.world.map;
    let hasFullBin = false;
    for (let element = 0; element < map.elementCapacity; element++) {
      if (
        map.elType[element] === ElementType.Path &&
        (map.elFlags[element] & PathFlag.Bin) !== 0 &&
        map.elData[element] === 12
      ) {
        hasFullBin = true;
        break;
      }
    }
    expect(hasFullBin).toBe(true);
    for (let tick = 0; tick < 8; tick++) {
      first.step();
      second.step();
    }
    expect(hashWorld(first.world)).toBe(hashWorld(second.world));
  });
});
