import type { System } from '../core/system';
import type { World } from '../core/world';
import { TILE_UNITS, Z_STEP } from '../core/constants';
import { nextDirection, DEFAULT_STAFF_OPTS } from '../pathfinding/navigate';
import { isRideInspectionDue, inspectRide } from '../rides/ride-operations';
import { StaffKind } from './staff-store';
import { ElementType, PathFlag } from '../map/tile-map';
import { RideState } from '../rides/ride-store';

const STAFF_SPEED = 12;

function moveStaff(
  world: World,
  slot: number,
  patrol: Uint8Array,
  walkableTiles: Int32Array,
  walkableCount: number,
): void {
  const staff = world.staff.cols;
  const map = world.map;
  const x = (staff.x[slot] / TILE_UNITS) | 0;
  const y = (staff.y[slot] / TILE_UNITS) | 0;
  const from = map.index(x, y);
  const tx = staff.targetX[slot];
  const ty = staff.targetY[slot];
  const target = map.index(tx, ty);
  const dir = nextDirection(world, from, target, world.rng, { ...DEFAULT_STAFF_OPTS, patrol });
  if (dir < 0) {
    let best = -1;
    let distance = 0x7fffffff;
    for (let i = 0; i < walkableCount; i++) {
      const tile = walkableTiles[i];
      if (patrol[tile] === 0) continue;
      const d = Math.abs((tile % map.width) - x) + Math.abs(((tile / map.width) | 0) - y);
      if (d < distance) {
        best = tile;
        distance = d;
      }
    }
    if (best < 0) return;
    const bx = best % map.width;
    const by = (best / map.width) | 0;
    staff.x[slot] = bx * TILE_UNITS + (TILE_UNITS >> 1);
    staff.y[slot] = by * TILE_UNITS + (TILE_UNITS >> 1);
    staff.z[slot] = map.heights[best] * Z_STEP;
    return;
  }
  const dx = dir === 0 ? STAFF_SPEED : dir === 2 ? -STAFF_SPEED : 0;
  const dy = dir === 1 ? STAFF_SPEED : dir === 3 ? -STAFF_SPEED : 0;
  staff.x[slot] += dx;
  staff.y[slot] += dy;
  staff.z[slot] =
    map.heights[map.index((staff.x[slot] / TILE_UNITS) | 0, (staff.y[slot] / TILE_UNITS) | 0)] *
    Z_STEP;
}

export function createStaffSystem(): System {
  let patrol = new Uint8Array(0);
  let unrestricted = new Uint8Array(0);
  let binTiles = new Int32Array(0);
  let binElements = new Int32Array(0);
  let binCount = 0;
  let walkableTiles = new Int32Array(0);
  let walkableCount = 0;
  let mapRevision = -1;
  let cachedMap: World['map'] | null = null;
  return {
    name: 'staff',
    update(world: World) {
      const map = world.map;
      const mapSize = world.map.width * world.map.height;
      if (patrol.length !== mapSize) {
        patrol = new Uint8Array(mapSize);
        unrestricted = new Uint8Array(mapSize).fill(1);
      }
      const staff = world.staff.cols;
      if (cachedMap !== map || mapRevision !== map.revision) {
        if (walkableTiles.length < mapSize) walkableTiles = new Int32Array(mapSize);
        if (binTiles.length < map.elementCapacity) {
          binTiles = new Int32Array(map.elementCapacity);
          binElements = new Int32Array(map.elementCapacity);
        }
        binCount = 0;
        walkableCount = 0;
        for (let tile = 0; tile < mapSize; tile++) {
          if (map.isWalkable(tile)) walkableTiles[walkableCount++] = tile;
          for (
            let element = map.firstElement(tile);
            element >= 0;
            element = map.nextElement(element)
          ) {
            if (
              map.elType[element] === ElementType.Path &&
              (map.elFlags[element] & PathFlag.Bin) !== 0
            ) {
              binTiles[binCount] = tile;
              binElements[binCount++] = element;
            }
          }
        }
        mapRevision = map.revision;
        cachedMap = map;
      }
      for (let slot = 0; slot < world.staff.count; slot++) {
        if ((world.tick + world.staff.slotToId[slot]) % 4 !== 0) continue;
        const area = staff.patrolArea[slot];
        const activePatrol =
          area > 0
            ? (patrol.set(world.patrolAreas.subarray((area - 1) * mapSize, area * mapSize)), patrol)
            : unrestricted;
        const x = (staff.x[slot] / TILE_UNITS) | 0;
        const y = (staff.y[slot] / TILE_UNITS) | 0;
        if (staff.kind[slot] === StaffKind.Handyman) {
          let nearest = -1;
          let distance = 0x7fffffff;
          for (let i = 0; i < world.litter.count; i++) {
            const lx = (world.litter.cols.x[i] / TILE_UNITS) | 0;
            const ly = (world.litter.cols.y[i] / TILE_UNITS) | 0;
            const tile = mapIndex(world, lx, ly);
            if (area > 0 && activePatrol[tile] === 0) continue;
            const d = Math.abs(lx - x) + Math.abs(ly - y);
            if (d < distance) {
              nearest = i;
              distance = d;
            }
          }
          if (nearest >= 0) {
            staff.targetX[slot] = (world.litter.cols.x[nearest] / TILE_UNITS) | 0;
            staff.targetY[slot] = (world.litter.cols.y[nearest] / TILE_UNITS) | 0;
            moveStaff(world, slot, activePatrol, walkableTiles, walkableCount);
            const nx = (staff.x[slot] / TILE_UNITS) | 0;
            const ny = (staff.y[slot] / TILE_UNITS) | 0;
            if (nx === staff.targetX[slot] && ny === staff.targetY[slot])
              world.litter.despawnSlot(nearest);
            continue;
          }
          let bin = -1;
          let binDistance = 0x7fffffff;
          for (let i = 0; i < binCount; i++) {
            const tile = binTiles[i];
            if (area > 0 && activePatrol[tile] === 0) continue;
            const element = binElements[i];
            if (map.elData[element] === 0) continue;
            const d = Math.abs((tile % map.width) - x) + Math.abs(((tile / map.width) | 0) - y);
            if (d < binDistance) {
              bin = tile;
              binDistance = d;
            }
          }
          if (bin >= 0) {
            staff.targetX[slot] = bin % map.width;
            staff.targetY[slot] = (bin / map.width) | 0;
            moveStaff(world, slot, activePatrol, walkableTiles, walkableCount);
            if (x === staff.targetX[slot] && y === staff.targetY[slot]) {
              const element = map.pathElement(bin, -1);
              if (element >= 0 && map.elData[element] > 0) map.elData[element] = 0;
            }
            continue;
          }
          const targetTile = map.index(staff.targetX[slot], staff.targetY[slot]);
          if (area > 0 && activePatrol[targetTile] === 0) {
            let chosen = -1;
            for (let attempt = 0; attempt < 24; attempt++) {
              const candidate = world.rng.int(mapSize);
              if (activePatrol[candidate] && map.isWalkable(candidate)) {
                chosen = candidate;
                break;
              }
            }
            if (chosen >= 0) {
              staff.targetX[slot] = chosen % map.width;
              staff.targetY[slot] = (chosen / map.width) | 0;
            }
          }
          moveStaff(world, slot, activePatrol, walkableTiles, walkableCount);
          continue;
        } else if (staff.kind[slot] === StaffKind.Mechanic) {
          let targetRide = -1;
          for (let i = 0; i < world.rides.count; i++) {
            const rideId = world.rides.slotToId[i];
            if (
              world.rides.cols.state[i] === RideState.Broken ||
              isRideInspectionDue(world, rideId)
            ) {
              targetRide = i;
              break;
            }
          }
          if (targetRide >= 0) {
            const rideId = world.rides.slotToId[targetRide];
            const rideX = world.rides.cols.rideX[targetRide];
            const rideY = world.rides.cols.rideY[targetRide];
            let targetTile = -1;
            let targetDistance = 0x7fffffff;
            for (let tile = 0; tile < mapSize; tile++) {
              if (!map.isWalkable(tile) || (area > 0 && activePatrol[tile] === 0)) continue;
              const distance =
                Math.abs((tile % map.width) - rideX) + Math.abs(((tile / map.width) | 0) - rideY);
              if (distance > 1 || distance >= targetDistance) continue;
              targetTile = tile;
              targetDistance = distance;
            }
            if (targetTile < 0) continue;
            staff.targetX[slot] = targetTile % map.width;
            staff.targetY[slot] = (targetTile / map.width) | 0;
            moveStaff(world, slot, activePatrol, walkableTiles, walkableCount);
            const nx = (staff.x[slot] / TILE_UNITS) | 0;
            const ny = (staff.y[slot] / TILE_UNITS) | 0;
            if (nx === staff.targetX[slot] && ny === staff.targetY[slot])
              inspectRide(world, rideId, world.staff.slotToId[slot]);
          }
        }
        if (staff.kind[slot] === StaffKind.Entertainer) {
          const target = mapIndex(world, staff.targetX[slot], staff.targetY[slot]);
          if (
            world.tick % 80 === 0 ||
            target < 0 ||
            !activePatrol[target] ||
            !map.isWalkable(target)
          ) {
            for (let attempt = 0; attempt < 24; attempt++) {
              const candidate = world.rng.int(mapSize);
              if (activePatrol[candidate] && map.isWalkable(candidate)) {
                staff.targetX[slot] = candidate % map.width;
                staff.targetY[slot] = (candidate / map.width) | 0;
                break;
              }
            }
          }
          moveStaff(world, slot, activePatrol, walkableTiles, walkableCount);
          if (world.tick % 80 === 0) {
            for (let guest = 0; guest < world.guests.count; guest++) {
              if (
                Math.abs(((world.guests.cols.x[guest] / TILE_UNITS) | 0) - x) <= 2 &&
                Math.abs(((world.guests.cols.y[guest] / TILE_UNITS) | 0) - y) <= 2
              )
                world.guests.cols.happiness[guest] = Math.min(
                  255,
                  world.guests.cols.happiness[guest] + 1,
                );
            }
          }
        }
      }
      world.economy.inputs.litter = Math.min(100, world.litter.count);
    },
  };
}

function mapIndex(world: World, x: number, y: number): number {
  return world.map.inBounds(x, y) ? world.map.index(x, y) : -1;
}

export const staffSystem = createStaffSystem();
