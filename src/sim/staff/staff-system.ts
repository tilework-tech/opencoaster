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
import { StaffKind, StaffOrder } from './staff-store';
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

const STAFF_UPDATE_STRIDE = 16;

function patrolAllows(patrol: PatrolMask, tile: number): boolean {
  return patrol instanceof Uint8Array ? patrol[tile] !== 0 : patrol.contains(tile);
}
const STAFF_SPEED = 48;
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
  const dx = dir === 0 ? STAFF_SPEED : dir === 2 ? -STAFF_SPEED : 0;
  const dy = dir === 1 ? STAFF_SPEED : dir === 3 ? -STAFF_SPEED : 0;
  staff.x[slot] += dx;
  staff.y[slot] += dy;
  staff.z[slot] = map.heightAt(staff.x[slot], staff.y[slot]);
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
  let guestHeadByTile = new Int32Array(0);
  let guestStampByTile = new Uint32Array(0);
  let guestNextById = new Int32Array(0);
  let guestIndexVersion = 0;
  let guestIndexWorld: World | null = null;
  let guestIndexTick = -1;
  let guestIndexBuilt = false;
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
      if (guestHeadByTile.length !== mapSize) {
        guestHeadByTile = new Int32Array(mapSize);
        guestStampByTile = new Uint32Array(mapSize);
        guestIndexVersion = 0;
      }
      if (guestNextById.length !== world.guests.capacity)
        guestNextById = new Int32Array(world.guests.capacity);
      if (guestIndexWorld !== world || guestIndexTick !== world.tick) {
        guestIndexWorld = world;
        guestIndexTick = world.tick;
        guestIndexBuilt = false;
      }
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
          if (!map.isWalkable(map.index(x, y))) {
            moveStaff(world, slot, activePatrol, walkableTiles, walkableCount, navOptions);
            continue;
          }
          const nearest =
            (orders & (1 << StaffOrder.SweepPaths)) !== 0 && world.litter.count > 0
              ? nearestLitterSlot(
                  world,
                  x,
                  y,
                  staff.z[slot],
                  area > 0 ? activePatrol : null,
                  litterHeadByTile,
                  litterStampByTile,
                  litterIndexVersion,
                  litterNextById,
                )
              : -1;
          if (nearest >= 0 && !shouldIgnoreLitter(world, map.isQueue(map.index(x, y)))) {
            staff.targetX[slot] = (world.litter.cols.x[nearest] / TILE_UNITS) | 0;
            staff.targetY[slot] = (world.litter.cols.y[nearest] / TILE_UNITS) | 0;
            moveStaff(world, slot, activePatrol, walkableTiles, walkableCount, navOptions);
            const nx = (staff.x[slot] / TILE_UNITS) | 0;
            const ny = (staff.y[slot] / TILE_UNITS) | 0;
            if (nx === staff.targetX[slot] && ny === staff.targetY[slot]) {
              world.litter.despawnSlot(nearest);
              staff.sweeps[slot] = Math.min(0xffff, staff.sweeps[slot] + 1);
            }
            continue;
          }
          const patrolOrNull = area > 0 ? activePatrol : null;
          const site =
            (orders & (1 << StaffOrder.WaterGardens)) !== 0
              ? findGardenSite(world, x, y, patrolOrNull)
              : -1;
          const stand = site >= 0 ? standTileFor(world, site, map.index(x, y), patrolOrNull) : -1;
          if (stand >= 0) {
            staff.targetX[slot] = stand % map.width;
            staff.targetY[slot] = (stand / map.width) | 0;
            moveStaff(world, slot, activePatrol, walkableTiles, walkableCount, navOptions);
            const nx = (staff.x[slot] / TILE_UNITS) | 0;
            const ny = (staff.y[slot] / TILE_UNITS) | 0;
            if (nx === staff.targetX[slot] && ny === staff.targetY[slot]) tendGarden(world, site);
            continue;
          }
          let bin = -1;
          let binDistance = 0x7fffffff;
          const staffTile = map.index(x, y);
          for (let i = 0; (orders & (1 << StaffOrder.EmptyBins)) !== 0 && i < binCount; i++) {
            const tile = binTiles[i];
            if (area > 0 && !patrolAllows(activePatrol, tile)) continue;
            const element = binElements[i];
            if ((map.elData[element] & 0xff) === 0xff || isPathElementBroken(map, element))
              continue;
            if (
              tile !== staffTile &&
              !isReachable(world, staffTile, tile, area > 0 ? activePatrol : null)
            )
              continue;
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
              if (element >= 0 && !isPathElementBroken(map, element))
                map.elData[element] = 0xff | (map.elData[element] & PATH_KEPT_BITS);
            }
            continue;
          }
          if (area === 0) continue;
          const targetTile = map.index(staff.targetX[slot], staff.targetY[slot]);
          if (area > 0 && !patrolAllows(activePatrol, targetTile)) {
            let chosen = -1;
            for (let attempt = 0; attempt < 24; attempt++) {
              const candidate = world.rng.int(mapSize);
              if (patrolAllows(activePatrol, candidate) && map.isWalkable(candidate)) {
                chosen = candidate;
                break;
              }
            }
            if (chosen >= 0) {
              staff.targetX[slot] = chosen % map.width;
              staff.targetY[slot] = (chosen / map.width) | 0;
            }
          }
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
            if (nx === staff.targetX[slot] && ny === staff.targetY[slot] && shouldService)
              serviceRide(world, rideId, world.staff.slotToId[slot]);
          }
        }
        if (
          (staff.kind[slot] === StaffKind.Entertainer &&
            (orders & (1 << StaffOrder.EntertainGuests)) !== 0) ||
          (staff.kind[slot] === StaffKind.Security &&
            (orders & (1 << StaffOrder.WatchForVandalism)) !== 0)
        ) {
          const workTick = (world.tick + world.staff.slotToId[slot]) % WANDER_STRIDE === 0;
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
          moveStaff(world, slot, activePatrol, walkableTiles, walkableCount, navOptions);
          if (staff.kind[slot] === StaffKind.Entertainer && workTick) {
            if (!guestIndexBuilt) {
              if (guestIndexVersion === 0xffffffff) {
                guestStampByTile.fill(0);
                guestIndexVersion = 1;
              } else {
                guestIndexVersion++;
              }
              buildGuestIndex(
                world,
                guestHeadByTile,
                guestStampByTile,
                guestNextById,
                guestIndexVersion,
              );
              guestIndexBuilt = true;
            }
            applyEntertainerEffect(
              world,
              x,
              y,
              guestHeadByTile,
              guestStampByTile,
              guestNextById,
              guestIndexVersion,
            );
          }
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
function findGardenSite(world: World, x: number, y: number, patrol: PatrolMask | null): number {
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
      if (!needsWatering(world, tile) && !needsMowing(world, tile)) continue;
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

function tendGarden(world: World, site: number): void {
  if (needsWatering(world, site)) waterFlowerBed(world, site);
  else if (needsMowing(world, site)) mowGrass(world, site);
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

function buildGuestIndex(
  world: World,
  headByTile: Int32Array,
  stampByTile: Uint32Array,
  nextById: Int32Array,
  version: number,
): void {
  const guests = world.guests;
  for (let slot = 0; slot < guests.count; slot++) {
    const x = (guests.cols.x[slot] / TILE_UNITS) | 0;
    const y = (guests.cols.y[slot] / TILE_UNITS) | 0;
    if (!world.map.inBounds(x, y)) continue;
    const tile = world.map.index(x, y);
    if (stampByTile[tile] !== version) {
      stampByTile[tile] = version;
      headByTile[tile] = -1;
    }
    const id = guests.slotToId[slot];
    nextById[id] = headByTile[tile];
    headByTile[tile] = id;
  }
}

function applyEntertainerEffect(
  world: World,
  x: number,
  y: number,
  headByTile: Int32Array,
  stampByTile: Uint32Array,
  nextById: Int32Array,
  indexVersion: number,
): void {
  const map = world.map;
  const guests = world.guests;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const tileX = x + dx;
      const tileY = y + dy;
      if (!map.inBounds(tileX, tileY)) continue;
      const tile = map.index(tileX, tileY);
      if (stampByTile[tile] !== indexVersion) continue;
      for (let id = headByTile[tile]; id >= 0; id = nextById[id]) {
        const slot = guests.idToSlot[id];
        if (slot >= 0) {
          guests.cols.happiness[slot] = Math.min(255, guests.cols.happiness[slot] + 1);
          guests.cols.happinessTarget[slot] = Math.min(255, guests.cols.happinessTarget[slot] + 1);
        }
      }
    }
  }
}

export const staffSystem = createStaffSystem();
