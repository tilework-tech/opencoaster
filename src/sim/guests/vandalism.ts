import type { System } from '../core/system';
import type { World } from '../core/world';
import { TILE_UNITS } from '../core/constants';
import { isPathElementBroken, markPathElementBroken, PathFlag } from '../map/tile-map';
import { StaffKind, StaffOrder } from '../staff/staff-store';
import { GuestState } from './guest-store';

const CHECK_INTERVAL = 32;
/** Guests at or below this happiness are angry enough to vandalise. */
export const ANGRY_HAPPINESS = 48;
/** How long a recent litter or vomit sighting remains in guest memory. */
export const GUEST_LITTER_MEMORY_TICKS = 2_048;
/** Duration stored after a successful vandalism, in simulation ticks. */
export const VANDAL_ANGER_TICKS = 512;
/** Guards strictly closer than this many tiles (Chebyshev, in world units) deter vandalism. */
export const SECURITY_RADIUS = 7;
export const VANDAL_SUCCESS_ROLL = 3276;

function securityGuardNearby(world: World, guestX: number, guestY: number): number {
  const staff = world.staff.cols;
  let nearest = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearestId = Number.POSITIVE_INFINITY;
  for (let slot = 0; slot < world.staff.count; slot++) {
    if (
      staff.kind[slot] !== StaffKind.Security ||
      (staff.orderFlags[slot] & (1 << StaffOrder.WatchForVandalism)) === 0
    )
      continue;
    const distance = Math.max(Math.abs(staff.x[slot] - guestX), Math.abs(staff.y[slot] - guestY));
    const staffId = world.staff.slotToId[slot];
    if (
      distance < SECURITY_RADIUS * TILE_UNITS &&
      (distance < nearestDistance || (distance === nearestDistance && staffId < nearestId))
    ) {
      nearest = slot;
      nearestDistance = distance;
      nearestId = staffId;
    }
  }
  return nearest;
}

/**
 * Angry guests may break a path addition they stand on. Security guards within reach stop it.
 */
export function createVandalismSystem(): System {
  let litterCountByTile = new Uint16Array(0);
  return {
    name: 'vandalism',
    update(world: World) {
      if (world.tick % CHECK_INTERVAL !== 0) return;
      const guests = world.guests.cols;
      const map = world.map;
      const mapSize = map.width * map.height;
      if (litterCountByTile.length !== mapSize) litterCountByTile = new Uint16Array(mapSize);
      litterCountByTile.fill(0);
      for (let slot = 0; slot < world.litter.count; slot++) {
        const tileX = world.litter.cols.x[slot] >> 8;
        const tileY = world.litter.cols.y[slot] >> 8;
        if (map.inBounds(tileX, tileY)) litterCountByTile[map.index(tileX, tileY)]++;
      }
      for (let slot = 0; slot < world.guests.count; slot++) {
        guests.angriness[slot] = Math.max(0, guests.angriness[slot] - CHECK_INTERVAL);
        guests.litterMemory[slot] = Math.max(0, guests.litterMemory[slot] - CHECK_INTERVAL);
        if (guests.state[slot] !== GuestState.Wandering) continue;
        const angry = guests.angriness[slot] > 0;
        const tileX = guests.x[slot] >> 8;
        const tileY = guests.y[slot] >> 8;
        if (!map.inBounds(tileX, tileY)) continue;
        const tile = map.index(tileX, tileY);
        if (litterCountByTile[tile] > 0) guests.litterMemory[slot] = GUEST_LITTER_MEMORY_TICKS;
        if (
          !angry &&
          (guests.happiness[slot] >= ANGRY_HAPPINESS ||
            guests.energy[slot] < 85 ||
            guests.litterMemory[slot] === 0)
        )
          continue;
        const element = map.pathElement(tile, -1);
        if (
          element < 0 ||
          (map.elFlags[element] & (PathFlag.Bench | PathFlag.Bin | PathFlag.Lamp)) === 0 ||
          isPathElementBroken(map, element)
        )
          continue;
        if (world.rng.int(0x10000) > VANDAL_SUCCESS_ROLL) continue;
        const guard = securityGuardNearby(world, guests.x[slot], guests.y[slot]);
        if (guard >= 0) {
          world.staff.cols.vandalsStopped[guard] = Math.min(
            0xffff,
            world.staff.cols.vandalsStopped[guard] + 1,
          );
          continue;
        }
        markPathElementBroken(map, element);
        guests.angriness[slot] = VANDAL_ANGER_TICKS;
      }
    },
  };
}

export const vandalismSystem = createVandalismSystem();
