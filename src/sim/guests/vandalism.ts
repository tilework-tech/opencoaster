import type { System } from '../core/system';
import type { World } from '../core/world';
import { TILE_UNITS } from '../core/constants';
import { PathFlag } from '../map/tile-map';
import { StaffKind } from '../staff/staff-store';
import { GuestState } from './guest-store';

const CHECK_INTERVAL = 32;
/** Each eligible walking guest has a 5% chance to vandalise on a check. */
const VANDAL_ODDS = 20;
/** Chebyshev tiles within which a security guard deters vandalism. */
export const SECURITY_RADIUS = 6;
/** Each check of an angry guest on a bench or bin breaks it with probability 1 / this. */

function securityNearby(world: World, tileX: number, tileY: number): boolean {
  const staff = world.staff.cols;
  for (let slot = 0; slot < world.staff.count; slot++) {
    if (staff.kind[slot] !== StaffKind.Security) continue;
    const guardX = (staff.x[slot] / TILE_UNITS) | 0;
    const guardY = (staff.y[slot] / TILE_UNITS) | 0;
    if (Math.abs(guardX - tileX) <= SECURITY_RADIUS && Math.abs(guardY - tileY) <= SECURITY_RADIUS)
      return true;
  }
  return false;
}

/**
 * Angry guests break the bench or bin they stand on, which reverts to plain path. Security
 * guards within reach stop it.
 */
export function createVandalismSystem(): System {
  return {
    name: 'vandalism',
    update(world: World) {
      if (world.tick % CHECK_INTERVAL !== 0) return;
      const guests = world.guests.cols;
      const map = world.map;
      for (let slot = 0; slot < world.guests.count; slot++) {
        if (guests.happiness[slot] >= 48 || guests.energy[slot] < 85) continue;
        if (guests.state[slot] !== GuestState.Wandering || world.litter.count === 0) continue;
        const tileX = guests.x[slot] >> 8;
        const tileY = guests.y[slot] >> 8;
        if (!map.inBounds(tileX, tileY)) continue;
        const element = map.pathElement(map.index(tileX, tileY), -1);
        if (element < 0 || (map.elFlags[element] & (PathFlag.Bench | PathFlag.Bin)) === 0) continue;
        if (world.rng.int(VANDAL_ODDS) !== 0) continue;
        if (securityNearby(world, tileX, tileY)) continue;
        map.elFlags[element] &= ~(PathFlag.Bench | PathFlag.Bin);
        map.elData[element] = 0;
        map.revision++;
      }
    },
  };
}

export const vandalismSystem = createVandalismSystem();
