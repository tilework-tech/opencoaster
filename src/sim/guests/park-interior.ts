import type { World } from '../core/world';
import { ElementType, OWNED, repairPathElement } from '../map/tile-map';
import { nodeCount, nodeTile, resolveGraph, stepNode } from '../pathfinding/graph';
import type { PeepSpawn } from './park';
import { hasParkEntrance, spawnPoints } from './park';

interface ApproachRegion {
  pathVersion: number;
  gateX: number;
  gateY: number;
  /** Flattened x,y pairs of the arrival points the mask was built for. */
  spawns: number[];
  mask: Uint8Array;
}

const regions = new WeakMap<World, ApproachRegion>();

/** Marks the axis-aligned span from `spawn` to the gate, the route of a park whose paths do not join them. */
function markStraightSpan(world: World, mask: Uint8Array, spawn: PeepSpawn): void {
  const map = world.map;
  const gx = world.park.entranceX;
  const gy = world.park.entranceY;
  if (spawn.x === gx) {
    for (let y = Math.min(spawn.y, gy); y <= Math.max(spawn.y, gy); y++) mask[map.index(gx, y)] = 1;
  } else if (spawn.y === gy) {
    for (let x = Math.min(spawn.x, gx); x <= Math.max(spawn.x, gx); x++) mask[map.index(x, gy)] = 1;
  }
}

function computeApproach(world: World): Uint8Array {
  const map = world.map;
  const graph = resolveGraph(map);
  const tiles = map.width * map.height;
  const mask = new Uint8Array(tiles);
  const gate = map.index(world.park.entranceX, world.park.entranceY);
  mask[gate] = 1;

  const parent = new Int32Array(nodeCount(graph)).fill(-1);
  const queue = new Int32Array(parent.length);
  parent[gate] = gate;
  let head = 0;
  let tail = 0;
  queue[tail++] = gate;
  while (head < tail) {
    const node = queue[head++]!;
    const exits = graph.edgeMask(node);
    for (let dir = 0; dir < 4; dir++) {
      if ((exits & (1 << dir)) === 0) continue;
      const next = stepNode(graph, node, dir);
      if (next < 0 || next >= parent.length || parent[next] >= 0) continue;
      parent[next] = node;
      queue[tail++] = next;
    }
  }

  for (const spawn of spawnPoints(world)) {
    let node = map.index(spawn.x, spawn.y);
    if (parent[node] < 0) {
      markStraightSpan(world, mask, spawn);
      continue;
    }
    while (node !== gate) {
      mask[nodeTile(graph, node)] = 1;
      node = parent[node]!;
    }
  }
  return mask;
}

/**
 * Per-tile flags (1 = outside) for the gate and the shortest footpath route from the gate to each
 * arrival point. Rebuilt only when the footpaths, gate or arrival points change.
 */
export function gateApproachMask(world: World): Uint8Array {
  const map = world.map;
  const cached = regions.get(world);
  if (cached && isCurrent(world, cached)) return cached.mask;
  const spawns: number[] = [];
  for (const spawn of world.park.spawns) spawns.push(spawn.x, spawn.y);
  const mask = computeApproach(world);
  regions.set(world, {
    pathVersion: map.pathVersion,
    gateX: world.park.entranceX,
    gateY: world.park.entranceY,
    spawns,
    mask,
  });
  return mask;
}

function isCurrent(world: World, region: ApproachRegion): boolean {
  const park = world.park;
  if (region.pathVersion !== world.map.pathVersion) return false;
  if (region.gateX !== park.entranceX || region.gateY !== park.entranceY) return false;
  if (region.spawns.length !== park.spawns.length * 2) return false;
  for (let i = 0; i < park.spawns.length; i++) {
    if (region.spawns[2 * i] !== park.spawns[i]!.x) return false;
    if (region.spawns[2 * i + 1] !== park.spawns[i]!.y) return false;
  }
  return true;
}

/**
 * True for the gate tile and the route from it out to each arrival point. These tiles are walkable
 * and joined to the park's paths, but guests on them have not been admitted yet or are already
 * gone, so they are not part of the park. The route is the shortest connected footpath between the
 * gate and the arrival point; when the paths do not join them it is the straight span instead.
 */
export function isGateApproach(world: World, x: number, y: number): boolean {
  if (!hasParkEntrance(world) || !world.map.inBounds(x, y)) return false;
  return gateApproachMask(world)[world.map.index(x, y)] === 1;
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
