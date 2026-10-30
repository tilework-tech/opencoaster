import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim/core/simulation';
import { hashWorld } from '../sim/core/hash';
import { OWNED } from '../sim/map/tile-map';
import { SCENERY_CATALOG, isWallScenery } from '../sim/map/scenery';
import { deserialize, serialize } from './save';

function decoratedSim(): Simulation {
  const sim = new Simulation({ seed: 9, width: 48, height: 48, maxGuests: 10 });
  sim.world.map.ownership.fill(OWNED);
  sim.world.map.waterLevel.fill(0);
  sim.world.map.fillFlat(4);
  return sim;
}

describe('scenery through commands and saves', () => {
  it('charges each item its catalog price on placement and removal price on removal', () => {
    SCENERY_CATALOG.forEach((definition, item) => {
      if (isWallScenery(item)) return;
      const sim = decoratedSim();
      const cash = sim.world.economy.cash;
      sim.enqueue({ type: 'placeScenery', x: 7, y: 7, item, rotation: 1 });
      sim.step();
      expect(cash - sim.world.economy.cash, definition.name).toBe(definition.priceCents);
      const afterPlacing = sim.world.economy.cash;
      sim.enqueue({ type: 'removeScenery', x: 7, y: 7 });
      sim.step();
      expect(afterPlacing - sim.world.economy.cash, definition.name).toBe(
        definition.removalPriceCents,
      );
    });
  });

  it('restores every placed decoration, with its facing, from a save', () => {
    const sim = decoratedSim();
    SCENERY_CATALOG.forEach((_, item) => {
      if (isWallScenery(item)) return;
      sim.enqueue({
        type: 'placeScenery',
        x: 3 + (item % 8) * 2,
        y: 3 + Math.floor(item / 8) * 2,
        item,
        rotation: item % 4,
      });
    });
    sim.step();
    const restored = deserialize(serialize(sim.world));
    expect(hashWorld(restored)).toBe(hashWorld(sim.world));
    const placed = (map: typeof sim.world.map): string[] => {
      const rows: string[] = [];
      for (let tile = 0; tile < map.width * map.height; tile++)
        for (let e = map.firstElement(tile); e >= 0; e = map.nextElement(e))
          rows.push(
            `${tile}:${map.elData[e]}:${map.elFlags[e]}:${map.elBase[e]}:${map.elClear[e]}`,
          );
      return rows;
    };
    const before = placed(sim.world.map);
    expect(before.length).toBeGreaterThanOrEqual(SCENERY_CATALOG.length - 3);
    expect(placed(restored.map)).toEqual(before);
  });
});
