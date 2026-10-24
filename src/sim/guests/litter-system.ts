import type { System } from '../core/system';
import type { World } from '../core/world';
import { LitterKind, dropLitter } from './litter-store';

export function createLitterSystem(): System {
  return {
    name: 'litter',
    update(world: World) {
      const litter = world.litter;
      for (let slot = 0; slot < litter.count;) {
        litter.cols.age[slot]++;
        if (litter.cols.age[slot] >= 20000) {
          litter.despawnSlot(slot);
          continue;
        }
        slot++;
      }
      if (world.tick % 160 !== 0) return;
      const guests = world.guests.cols;
      for (let i = 0; i < world.guests.count; i++) {
        const x = (guests.x[i] / TILE_UNITS) | 0;
        const y = (guests.y[i] / TILE_UNITS) | 0;
        if (guests.nausea[i] > 180) dropLitter(world, x, y, LitterKind.Vomit);
        else if (world.rng.int(8) === 0) dropLitter(world, x, y, LitterKind.Trash);
      }
      world.economy.inputs.litter = Math.min(100, litter.count);
    },
  };
}

import { TILE_UNITS } from '../core/constants';
export const litterSystem = createLitterSystem();
