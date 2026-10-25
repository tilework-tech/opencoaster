import type { System } from '../core/system';
import type { World } from '../core/world';
import { LitterKind, dropLitter } from './litter-store';

/** A guest drops trash at roughly one in this many litter checks (every 160 ticks). */
const TRASH_ONE_IN = 48;
export const VOMIT_NAUSEA_THRESHOLD = 140;
export const VOMIT_NAUSEA_REDUCTION = 30;

export function createLitterSystem(): System {
  return {
    name: 'litter',
    update(world: World) {
      const litter = world.litter;
      for (let slot = 0; slot < litter.count; slot++)
        if (litter.cols.age[slot] < 0xffff) litter.cols.age[slot]++;
      if (world.tick % 160 !== 0) return;
      const guests = world.guests.cols;
      for (let i = 0; i < world.guests.count; i++) {
        const x = (guests.x[i] / TILE_UNITS) | 0;
        const y = (guests.y[i] / TILE_UNITS) | 0;
        if (guests.nausea[i] >= VOMIT_NAUSEA_THRESHOLD) {
          if (dropLitter(world, x, y, LitterKind.Vomit)) {
            guests.nausea[i] = Math.max(0, guests.nausea[i] - VOMIT_NAUSEA_REDUCTION);
            guests.hunger[i] = Math.floor(guests.hunger[i] / 2);
          }
        } else if (world.rng.int(TRASH_ONE_IN) === 0) dropLitter(world, x, y, LitterKind.Trash);
      }
      world.economy.inputs.litter = Math.min(100, litter.count);
    },
  };
}

import { TILE_UNITS } from '../core/constants';
export const litterSystem = createLitterSystem();
