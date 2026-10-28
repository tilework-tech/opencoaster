import type { System } from '../core/system';
import type { World } from '../core/world';
import { TILE_UNITS, Z_STEP } from '../core/constants';
import { resolveGraph } from '../pathfinding/graph';
import { isReachable, nextDirection, DEFAULT_STAFF_OPTS } from '../pathfinding/navigate';
import type { PatrolMask } from '../pathfinding/navigate';
import type { NavOptions } from '../pathfinding/navigate';
import { isRideInspectionDue } from '../rides/ride-operations';
import {
  markMechanicHeading,
  rideServiceX,
  rideServiceY,
  serviceRide,
} from '../rides/ride-maintenance';
import { MOW_TILE_DELAY, StaffKind, StaffOrder } from './staff-store';
import {
  DIR_DX,
  DIR_DY,
  ElementType,
  isPathElementBroken,
  PATH_KEPT_BITS,
  PathFlag,
} from '../map/tile-map';
import { RideState } from '../rides/ride-store';
import { growGrounds, mowGrass, needsMowing, needsWatering, waterFlowerBed } from './grounds';
import { ENTERTAINER_WAVE_ROLL, entertainNearbyGuests } from './entertainer';
import { GuestState } from '../guests/guest-store';

const STAFF_UPDATE_STRIDE = 16;

function patrolAllows(patrol: PatrolMask, tile: number): boolean {
  return patrol instanceof Uint8Array ? patrol[tile] !== 0 : patrol.contains(tile);
}
/** Staff energy is set when they are hired and never changes. */
export const STAFF_ENERGY = 96;
/** Walking guests within three tiles that slow a security guard down. */
export const SECURITY_CROWD_COUNT = 20;
const SECURITY_CROWD_RADIUS_TILES = 3;
const SECURITY_CROWD_STRIDE = 128;

/**
 * World units a worker advances in one update. Energy is a fraction of 256 steps per tick, each a
 * 32nd of a tile, over the 16-tick update stride; slowed walkers cover half.
 */
export function staffStepUnits(energy: number, slowed: boolean): number {
  const full = (energy * STAFF_UPDATE_STRIDE * (TILE_UNITS / 32)) >> 8;
  return slowed ? full >> 1 : full;
}
const GARDEN_SEARCH_RADIUS = 10;
const WANDER_STRIDE = 80;
export const HANDYMAN_SWEEP_RADIUS_TILES = 3;
const HANDYMAN_IGNORE_NORMAL_PATH_ROLL = 6553;
const HANDYMAN_IGNORE_QUEUE_ROLL = 58982;

function moveStaff(
  world: World,
  slot: number,
  patrol: PatrolMask,
  walkableTiles: Int32Array,
  walkableCount: number,
  navOptions: NavOptions,
): void {
  const staff = world.staff.cols;
  const map = world.map;
  const x = (staff.x[slot] / TILE_UNITS) | 0;
  const y = (staff.y[slot] / TILE_UNITS) | 0;
  const from = map.index(x, y);
  const tx = staff.targetX[slot];
  const ty = staff.targetY[slot];
  const target = map.index(tx, ty);
  navOptions.patrol = patrol;
  const dir = nextDirection(world, from, target, world.rng, navOptions);
  if (dir < 0) {
    let best = -1;
    let distance = 0x7fffffff;
    for (let i = 0; i < walkableCount; i++) {
      const tile = walkableTiles[i];
      if (!patrolAllows(patrol, tile)) continue;
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
    staff.z[slot] = map.heightAt(
      bx * TILE_UNITS + (TILE_UNITS >> 1),
      by * TILE_UNITS + (TILE_UNITS >> 1),
    );
    return;
  }
  const step = staffStepUnits(STAFF_ENERGY, staff.walkSlow[slot] !== 0);
  const dx = dir === 0 ? step : dir === 2 ? -step : 0;
  const dy = dir === 1 ? step : dir === 3 ? -step : 0;
  staff.x[slot] += dx;
  staff.y[slot] += dy;
  staff.z[slot] = map.heightAt(staff.x[slot], staff.y[slot]);
  if (((staff.x[slot] / TILE_UNITS) | 0) !== x || ((staff.y[slot] / TILE_UNITS) | 0) !== y)
    staff.mowTimeout[slot] = Math.min(0xff, staff.mowTimeout[slot] + 1);
}

export function createStaffSystem(): System {
  let unrestricted = new Uint8Array(0);
  let patrolSource: Uint32Array | null = null;
  let patrolRevision = -1;
  const patrolMasks = new Map<number, PatrolMask>();
  const navOptions: NavOptions = { ...DEFAULT_STAFF_OPTS, patrol: unrestricted };
  let binTiles = new Int32Array(0);
  let binElements = new Int32Array(0);
  let binCount = 0;
  let litterHeadByTile = new Int32Array(0);
  let litterStampByTile = new Uint32Array(0);
  let litterNextById = new Int32Array(0);
  let litterIndexVersion = 0;
  let walkableTiles = new Int32Array(0);
  let walkableCount = 0;
  let mapRevision = -1;
  let cachedMap: World['map'] | null = null;
  return {
    name: 'staff',
    update(world: World) {
      growGrounds(world);
      const map = world.map;
      const mapSize = world.map.width * world.map.height;
      if (unrestricted.length !== mapSize) {
        unrestricted = new Uint8Array(mapSize).fill(1);
      }
      if (patrolSource !== world.patrolAreas || patrolRevision !== world.patrolRevision) {
        patrolSource = world.patrolAreas;
        patrolRevision = world.patrolRevision;
        patrolMasks.clear();
      }

      const staff = world.staff.cols;
      if (litterHeadByTile.length !== mapSize) {
        litterHeadByTile = new Int32Array(mapSize);
        litterStampByTile = new Uint32Array(mapSize);
        litterIndexVersion = 0;
      }
      if (litterNextById.length !== world.litter.capacity)
        litterNextById = new Int32Array(world.litter.capacity);
      if (cachedMap !== map || mapRevision !== map.revision) {
        if (walkableTiles.length < mapSize) walkableTiles = new Int32Array(mapSize);
        if (binTiles.length < map.elementCapacity) {
          binTiles = new Int32Array(map.elementCapacity);
          binElements = new Int32Array(map.elementCapacity);
        }
        binCount = 0;
        walkableCount = 0;
        const graph = resolveGraph(map);
        for (let tile = 0; tile < mapSize; tile++) {
          if (map.isWalkable(tile) && graph.edgeMask(tile) !== 0)
            walkableTiles[walkableCount++] = tile;
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
      let hasHandyman = false;
      for (let slot = 0; slot < world.staff.count; slot++) {
        if (staff.kind[slot] === StaffKind.Handyman) {
          hasHandyman = true;
          break;
        }
      }
      if (world.litter.count > 0 && hasHandyman) {
        if (litterIndexVersion === 0xffffffff) {
          litterStampByTile.fill(0);
          litterIndexVersion = 1;
        } else {
          litterIndexVersion++;
        }
        for (let slot = 0; slot < world.litter.count; slot++) {
          const x = (world.litter.cols.x[slot] / TILE_UNITS) | 0;
          const y = (world.litter.cols.y[slot] / TILE_UNITS) | 0;
          const tile = map.index(x, y);
          const id = world.litter.slotToId[slot];
          if (litterStampByTile[tile] !== litterIndexVersion) {
            litterStampByTile[tile] = litterIndexVersion;
            litterHeadByTile[tile] = -1;
          }
          litterNextById[id] = litterHeadByTile[tile];
          litterHeadByTile[tile] = id;
        }
      }
      for (let slot = 0; slot < world.staff.count; slot++) {
        if ((world.tick + world.staff.slotToId[slot]) % STAFF_UPDATE_STRIDE !== 0) continue;
        const orders = staff.orderFlags[slot];
        const area = staff.patrolArea[slot];
        let activePatrol: PatrolMask = unrestricted;
        if (area > 0) {
          let mask = patrolMasks.get(area);
          if (!mask) {
            const blocksWide = Math.ceil(map.width / 4);
            const row = (area - 1) * world.patrolWordsPerArea;
            mask = {
              contains: (tile) => {
                const x = tile % map.width;
                const y = (tile / map.width) | 0;
                const block = (y >>> 2) * blocksWide + (x >>> 2);
                return (world.patrolAreas[row + (block >>> 5)]! & (1 << (block & 31))) !== 0;
              },
            };
            patrolMasks.set(area, mask);
          }
          activePatrol = mask;
        }
        const x = (staff.x[slot] / TILE_UNITS) | 0;
        const y = (staff.y[slot] / TILE_UNITS) | 0;
        if (staff.kind[slot] === StaffKind.Handyman) {
          const staffTile = map.index(x, y);
          if (!map.isWalkable(staffTile)) {
            moveStaff(world, slot, activePatrol, walkableTiles, walkableCount, navOptions);
            continue;
          }
          const patrolOrNull = area > 0 ? activePatrol : null;
          const nearest =
            (orders & (1 << StaffOrder.SweepPaths)) !== 0 && world.litter.count > 0
              ? nearestLitterSlot(
                  world,
                  x,
                  y,
                  staff.z[slot],
                  patrolOrNull,
                  litterHeadByTile,
                  litterStampByTile,
                  litterIndexVersion,
                  litterNextById,
                )
              : -1;
          if (nearest >= 0 && !shouldIgnoreLitter(world, map.isQueue(staffTile))) {
            staff.targetX[slot] = (world.litter.cols.x[nearest] / TILE_UNITS) | 0;
            staff.targetY[slot] = (world.litter.cols.y[nearest] / TILE_UNITS) | 0;
            moveStaff(world, slot, activePatrol, walkableTiles, walkableCount, navOptions);
            const nx = (staff.x[slot] / TILE_UNITS) | 0;
            const ny = (staff.y[slot] / TILE_UNITS) | 0;
            if (nx === staff.targetX[slot] && ny === staff.targetY[slot]) {
              world.litter.despawnSlot(nearest);
              staff.sweeps[slot] = Math.min(0xffff, staff.sweeps[slot] + 1);
              staff.mowTimeout[slot] = 0;
            }
            continue;
          }
          const mowSite =
            (orders & (1 << StaffOrder.MowGrass)) !== 0 && staff.mowTimeout[slot] >= MOW_TILE_DELAY
              ? findGardenSite(world, x, y, patrolOrNull, needsMowing)
              : -1;
          const mowStand =
            mowSite >= 0 ? standTileFor(world, mowSite, staffTile, patrolOrNull) : -1;
          if (mowStand >= 0) {
            staff.targetX[slot] = mowStand % map.width;
            staff.targetY[slot] = (mowStand / map.width) | 0;
            moveStaff(world, slot, activePatrol, walkableTiles, walkableCount, navOptions);
            const nx = (staff.x[slot] / TILE_UNITS) | 0;
            const ny = (staff.y[slot] / TILE_UNITS) | 0;
            if (nx === staff.targetX[slot] && ny === staff.targetY[slot]) {
              mowGrass(world, mowSite);
              staff.lawnsMown[slot] = Math.min(0xffff, staff.lawnsMown[slot] + 1);
            }
            continue;
          }
          let bin = -1;
          let binDistance = 0x7fffffff;
          for (let i = 0; (orders & (1 << StaffOrder.EmptyBins)) !== 0 && i < binCount; i++) {
            const tile = binTiles[i];
            if (area > 0 && !patrolAllows(activePatrol, tile)) continue;
            const element = binElements[i];
            if (!binHasFullSide(map.elData[element]) || isPathElementBroken(map, element)) continue;
            if (tile !== staffTile && !isReachable(world, staffTile, tile, patrolOrNull)) continue;
            const d = Math.abs((tile % map.width) - x) + Math.abs(((tile / map.width) | 0) - y);
            if (d < binDistance) {
              bin = tile;
              binDistance = d;
            }
          }
          if (bin >= 0) {
            staff.targetX[slot] = bin % map.width;
            staff.targetY[slot] = (bin / map.width) | 0;
            moveStaff(world, slot, activePatrol, walkableTiles, walkableCount, navOptions);
            if (x === staff.targetX[slot] && y === staff.targetY[slot]) {
              const element = map.pathElement(bin, -1);
              if (element >= 0 && !isPathElementBroken(map, element)) {
                map.elData[element] = 0xff | (map.elData[element] & PATH_KEPT_BITS);
                staff.binsEmptied[slot] = Math.min(0xffff, staff.binsEmptied[slot] + 1);
                staff.mowTimeout[slot] = 0;
              }
            }
            continue;
          }
          const waterSite =
            (orders & (1 << StaffOrder.WaterGardens)) !== 0
              ? findGardenSite(world, x, y, patrolOrNull, needsWatering)
              : -1;
          const waterStand =
            waterSite >= 0 ? standTileFor(world, waterSite, staffTile, patrolOrNull) : -1;
          if (waterStand >= 0) {
            staff.targetX[slot] = waterStand % map.width;
            staff.targetY[slot] = (waterStand / map.width) | 0;
            moveStaff(world, slot, activePatrol, walkableTiles, walkableCount, navOptions);
            const nx = (staff.x[slot] / TILE_UNITS) | 0;
            const ny = (staff.y[slot] / TILE_UNITS) | 0;
            if (nx === staff.targetX[slot] && ny === staff.targetY[slot]) {
              waterFlowerBed(world, waterSite);
              staff.gardensWatered[slot] = Math.min(0xffff, staff.gardensWatered[slot] + 1);
              staff.mowTimeout[slot] = 0;
            }
            continue;
          }
          wander(world, slot, activePatrol, mapSize);
          moveStaff(world, slot, activePatrol, walkableTiles, walkableCount, navOptions);
          continue;
        } else if (staff.kind[slot] === StaffKind.Mechanic) {
          let targetRide = -1;
          let targetTile = -1;
          let targetKey = 0x7fffffff;
          const staffTile = map.index(x, y);
          if (area > 0 && !patrolAllows(activePatrol, staffTile)) {
            moveStaff(world, slot, activePatrol, walkableTiles, walkableCount, navOptions);
            continue;
          }
          const canCheckRoute = map.isWalkable(staffTile);
          for (let i = 0; i < world.rides.count; i++) {
            const rideId = world.rides.slotToId[i];
            const broken =
              (orders & (1 << StaffOrder.RepairRides)) !== 0 &&
              world.rides.cols.state[i] === RideState.Broken;
            const inspectionDue =
              (orders & (1 << StaffOrder.InspectRides)) !== 0 && isRideInspectionDue(world, rideId);
            if (!broken && !inspectionDue) continue;
            const rideX = rideServiceX(world, i);
            const rideY = rideServiceY(world, i);
            let serviceTile = -1;
            for (let dir = 0; dir < 4; dir++) {
              const tileX = rideX + DIR_DX[dir];
              const tileY = rideY + DIR_DY[dir];
              if (!map.inBounds(tileX, tileY)) continue;
              const candidate = map.index(tileX, tileY);
              if (
                !map.isWalkable(candidate) ||
                (area > 0 && !patrolAllows(activePatrol, candidate))
              )
                continue;
              if (
                canCheckRoute &&
                staffTile !== candidate &&
                !isReachable(world, staffTile, candidate, area > 0 ? activePatrol : null)
              )
                continue;
              serviceTile = candidate;
              break;
            }
            if (serviceTile < 0) continue;
            const distance = Math.abs(rideX - x) + Math.abs(rideY - y);
            const key = (broken ? 0 : 0x10000) + distance;
            if (key < targetKey) {
              targetKey = key;
              targetRide = i;
              targetTile = serviceTile;
            }
          }
          if (targetRide >= 0) {
            const rideId = world.rides.slotToId[targetRide];
            markMechanicHeading(world, targetRide);
            staff.targetX[slot] = targetTile % map.width;
            staff.targetY[slot] = (targetTile / map.width) | 0;
            moveStaff(world, slot, activePatrol, walkableTiles, walkableCount, navOptions);
            const nx = (staff.x[slot] / TILE_UNITS) | 0;
            const ny = (staff.y[slot] / TILE_UNITS) | 0;
            const currentState = world.rides.cols.state[targetRide];
            const shouldService =
              (currentState === RideState.Broken &&
                (orders & (1 << StaffOrder.RepairRides)) !== 0) ||
              (currentState !== RideState.Broken &&
                (orders & (1 << StaffOrder.InspectRides)) !== 0 &&
                isRideInspectionDue(world, rideId));
            if (
              nx === staff.targetX[slot] &&
              ny === staff.targetY[slot] &&
              shouldService &&
              serviceRide(world, rideId, world.staff.slotToId[slot])
            ) {
              if (currentState === RideState.Broken)
                staff.ridesFixed[slot] = Math.min(0xffff, staff.ridesFixed[slot] + 1);
              else staff.ridesInspected[slot] = Math.min(0xffff, staff.ridesInspected[slot] + 1);
            }
          } else {
            wander(world, slot, activePatrol, mapSize);
            moveStaff(world, slot, activePatrol, walkableTiles, walkableCount, navOptions);
          }
        }
        if (
          (staff.kind[slot] === StaffKind.Entertainer &&
            (orders & (1 << StaffOrder.EntertainGuests)) !== 0) ||
          (staff.kind[slot] === StaffKind.Security &&
            (orders & (1 << StaffOrder.WatchForVandalism)) !== 0)
        ) {
          const phase = world.tick + world.staff.slotToId[slot];
          const workTick = phase % WANDER_STRIDE === 0;
          const target = mapIndex(world, staff.targetX[slot], staff.targetY[slot]);
          if (
            workTick ||
            target < 0 ||
            !patrolAllows(activePatrol, target) ||
            !map.isWalkable(target)
          ) {
            for (let attempt = 0; attempt < 24; attempt++) {
              const candidate = world.rng.int(mapSize);
              if (patrolAllows(activePatrol, candidate) && map.isWalkable(candidate)) {
                staff.targetX[slot] = candidate % map.width;
                staff.targetY[slot] = (candidate / map.width) | 0;
                break;
              }
            }
          }
          if (staff.kind[slot] === StaffKind.Security && phase % SECURITY_CROWD_STRIDE === 0)
            staff.walkSlow[slot] = guardIsCrowded(world, slot) ? 1 : 0;
          moveStaff(world, slot, activePatrol, walkableTiles, walkableCount, navOptions);
          if (
            staff.kind[slot] === StaffKind.Entertainer &&
            workTick &&
            world.rng.int(0x10000) <= ENTERTAINER_WAVE_ROLL
          )
            entertainNearbyGuests(world, slot);
        }
      }
      world.economy.inputs.litter = Math.min(100, world.litter.count);
    },
  };
}

/**
 * Nearest site within reach that a handyman can work from, or -1. Scans only the search window
 * around the handyman; ties go to the lowest tile index.
 */
function findGardenSite(
  world: World,
  x: number,
  y: number,
  patrol: PatrolMask | null,
  needsWork: (world: World, tile: number) => boolean,
): number {
  const map = world.map;
  const from = map.index(x, y);
  let best = -1;
  let bestDistance = 0x7fffffff;
  for (let dy = -GARDEN_SEARCH_RADIUS; dy <= GARDEN_SEARCH_RADIUS; dy++) {
    for (let dx = -GARDEN_SEARCH_RADIUS; dx <= GARDEN_SEARCH_RADIUS; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (!map.inBounds(tx, ty)) continue;
      const distance = Math.abs(dx) + Math.abs(dy);
      if (distance > bestDistance) continue;
      const tile = map.index(tx, ty);
      if (distance === bestDistance && tile > best) continue;
      if (!needsWork(world, tile)) continue;
      if (standTileFor(world, tile, from, patrol) < 0) continue;
      best = tile;
      bestDistance = distance;
    }
  }
  return best;
}

/** A walkable, reachable tile beside `site` where a handyman can work on it, or -1. */
function standTileFor(world: World, site: number, from: number, patrol: PatrolMask | null): number {
  const map = world.map;
  const siteX = site % map.width;
  const siteY = (site / map.width) | 0;
  for (let dir = 0; dir < 4; dir++) {
    const tileX = siteX + DIR_DX[dir];
    const tileY = siteY + DIR_DY[dir];
    if (!map.inBounds(tileX, tileY)) continue;
    const tile = map.index(tileX, tileY);
    if (!map.isWalkable(tile) || (patrol !== null && !patrolAllows(patrol, tile))) continue;
    if (tile !== from && !isReachable(world, from, tile, patrol)) continue;
    return tile;
  }
  return -1;
}

/** Whether any of a bin's four sides is completely full, the only state a handyman empties. */
function binHasFullSide(data: number): boolean {
  for (let side = 0; side < 4; side++) if (((data >> (side * 2)) & 3) === 0) return true;
  return false;
}

/** Sends an idle worker to a random walkable tile when it has arrived or its target is unusable. */
function wander(world: World, slot: number, patrol: PatrolMask, mapSize: number): void {
  const staff = world.staff.cols;
  const map = world.map;
  const x = (staff.x[slot] / TILE_UNITS) | 0;
  const y = (staff.y[slot] / TILE_UNITS) | 0;
  const target = mapIndex(world, staff.targetX[slot], staff.targetY[slot]);
  const arrived = staff.targetX[slot] === x && staff.targetY[slot] === y;
  if (!arrived && target >= 0 && patrolAllows(patrol, target) && map.isWalkable(target)) return;
  for (let attempt = 0; attempt < 24; attempt++) {
    const candidate = world.rng.int(mapSize);
    if (patrolAllows(patrol, candidate) && map.isWalkable(candidate)) {
      staff.targetX[slot] = candidate % map.width;
      staff.targetY[slot] = (candidate / map.width) | 0;
      return;
    }
  }
}

function nearestLitterSlot(
  world: World,
  x: number,
  y: number,
  z: number,
  patrol: PatrolMask | null,
  headByTile: Int32Array,
  stampByTile: Uint32Array,
  indexVersion: number,
  nextById: Int32Array,
): number {
  const map = world.map;
  const from = map.index(x, y);
  let best = -1;
  let bestDistance = HANDYMAN_SWEEP_RADIUS_TILES + 1;
  for (let dy = -HANDYMAN_SWEEP_RADIUS_TILES; dy <= HANDYMAN_SWEEP_RADIUS_TILES; dy++) {
    for (let dx = -HANDYMAN_SWEEP_RADIUS_TILES; dx <= HANDYMAN_SWEEP_RADIUS_TILES; dx++) {
      const tileX = x + dx;
      const tileY = y + dy;
      if (!map.inBounds(tileX, tileY)) continue;
      const tile = map.index(tileX, tileY);
      if (!map.isWalkable(tile) || (patrol !== null && !patrolAllows(patrol, tile))) continue;
      if (tile !== from && !isReachable(world, from, tile, patrol)) continue;
      for (
        let id = stampByTile[tile] === indexVersion ? headByTile[tile] : -1;
        id >= 0;
        id = nextById[id]
      ) {
        const slot = world.litter.idToSlot[id];
        if (slot < 0) continue;
        const horizontal = Math.max(Math.abs(dx), Math.abs(dy));
        const vertical = (Math.abs(world.litter.cols.z[slot] - z) / Z_STEP) * 4;
        const distance = horizontal + vertical;
        if (distance <= HANDYMAN_SWEEP_RADIUS_TILES && distance < bestDistance) {
          best = slot;
          bestDistance = distance;
        }
      }
    }
  }
  return best;
}

function shouldIgnoreLitter(world: World, queue: boolean): boolean {
  const maximum = queue ? HANDYMAN_IGNORE_QUEUE_ROLL : HANDYMAN_IGNORE_NORMAL_PATH_ROLL;
  return world.rng.int(0x10000) <= maximum;
}

function mapIndex(world: World, x: number, y: number): number {
  return world.map.inBounds(x, y) ? world.map.index(x, y) : -1;
}

/** Whether enough guests are walking close to a security guard to slow it down. */
function guardIsCrowded(world: World, slot: number): boolean {
  const staff = world.staff.cols;
  const guests = world.guests.cols;
  const tileX = (staff.x[slot] / TILE_UNITS) | 0;
  const tileY = (staff.y[slot] / TILE_UNITS) | 0;
  let walking = 0;
  for (let guest = 0; guest < world.guests.count; guest++) {
    if (guests.state[guest] !== GuestState.Wandering) continue;
    if (Math.abs(((guests.x[guest] / TILE_UNITS) | 0) - tileX) > SECURITY_CROWD_RADIUS_TILES)
      continue;
    if (Math.abs(((guests.y[guest] / TILE_UNITS) | 0) - tileY) > SECURITY_CROWD_RADIUS_TILES)
      continue;
    if (Math.abs(guests.z[guest] - staff.z[slot]) > Z_STEP) continue;
    if (++walking >= SECURITY_CROWD_COUNT) return true;
  }
  return false;
}

export const staffSystem = createStaffSystem();
