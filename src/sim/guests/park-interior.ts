import type { World } from '../core/world';
import { ElementType, OWNED, repairPathElement } from '../map/tile-map';
import { hasParkEntrance, spawnPoints } from './park';

function between(value: number, a: number, b: number): boolean {
  return value >= Math.min(a, b) && value <= Math.max(a, b);
}

/**
 * True for the gate tile and the straight approach from it out to each arrival point. These tiles
 * are walkable and joined to the park's paths, but guests on them have not been admitted yet or
 * are already gone, so they are not part of the park.
 */
export function isGateApproach(world: World, x: number, y: number): boolean {
  if (!hasParkEntrance(world)) return false;
  const gx = world.park.entranceX;
  const gy = world.park.entranceY;
  if (x === gx && y === gy) return true;
  for (const spawn of spawnPoints(world)) {
    if (x === gx && spawn.x === gx && between(y, spawn.y, gy)) return true;
    if (y === gy && spawn.y === gy && between(x, spawn.x, gx)) return true;
  }
  return false;
}

/**
 * Whether guest mess may appear on a tile: it belongs to the park (owned land, not construction
 * rights alone) and is on the park side of the gate.
 */
export function isParkInterior(world: World, x: number, y: number): boolean {
  const map = world.map;
  if (!map.inBounds(x, y)) return false;
  if ((map.ownership[map.index(x, y)] & OWNED) === 0) return false;
  return !isGateApproach(world, x, y);
}

/**
 * Removes litter and repairs vandalised path additions on tiles outside the park. Run when a save
 * loads and when the gate moves, the two times the set of outside tiles can differ from the mess.
 */
export function purgeExteriorMess(world: World): { litter: number; repaired: number } {
  const litter = world.litter;
  let removedLitter = 0;
  for (let slot = litter.count - 1; slot >= 0; slot--) {
    if (isParkInterior(world, litter.cols.x[slot] >> 8, litter.cols.y[slot] >> 8)) continue;
    litter.despawnSlot(slot);
    removedLitter++;
  }
  const map = world.map;
  let repaired = 0;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tile = map.index(x, y);
      let interior: boolean | undefined;
      for (let element = map.firstElement(tile); element >= 0; element = map.nextElement(element)) {
        if (map.elType[element] !== ElementType.Path) continue;
        interior ??= isParkInterior(world, x, y);
        if (interior) break;
        const before = map.revision;
        repairPathElement(map, element);
        if (map.revision !== before) repaired++;
      }
    }
  }
  return { litter: removedLitter, repaired };
}
