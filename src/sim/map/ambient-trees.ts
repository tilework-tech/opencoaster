import type { World } from '../core/world';
import { worldOccupancies } from './occupancy';
import { SceneryItem, SCENERY_CATALOG } from './scenery';
import { ElementType, MAX_ELEMENT_BASE, OWNED, Surface } from './tile-map';

const GRASS_TREES = [
  SceneryItem.OakTree,
  SceneryItem.Conifer,
  SceneryItem.BirchTree,
  SceneryItem.BlossomTree,
  SceneryItem.AutumnTree,
  SceneryItem.TopiaryTree,
] as const;

/** Returns the tree that the former coordinate-based renderer drew at this tile. */
export function legacyAmbientTreeItem(surface: number, x: number, y: number): SceneryItem | null {
  if ((x * 17 + y * 31) % 23 !== 7) return null;
  if (surface === 1)
    return (x * 3 + y * 5) % 2 === 0 ? SceneryItem.PalmTree : SceneryItem.CactusTree;
  if (surface !== 0) return null;
  return GRASS_TREES[(x * 3 + y * 5) % GRASS_TREES.length]!;
}

const TREE_BELT_WIDTH = 3;
const OWNED_INTERIOR_TREE_THRESHOLD = 0.93;

export interface TreeClearArea {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function smooth(value: number): number {
  return value * value * (3 - 2 * value);
}

function hashUnit(x: number, y: number, seed: number): number {
  let value = Math.imul(x ^ seed, 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= Math.imul(y ^ (seed >>> 1), 0x9e3779b9);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}

function valueNoise(x: number, y: number, cellSize: number, seed: number): number {
  const gx = Math.floor(x / cellSize);
  const gy = Math.floor(y / cellSize);
  const fx = smooth((x - gx * cellSize) / cellSize);
  const fy = smooth((y - gy * cellSize) / cellSize);
  const top = hashUnit(gx, gy, seed) * (1 - fx) + hashUnit(gx + 1, gy, seed) * fx;
  const bottom = hashUnit(gx, gy + 1, seed) * (1 - fx) + hashUnit(gx + 1, gy + 1, seed) * fx;
  return top * (1 - fy) + bottom * fy;
}

function boundaryDistance(world: World): Int8Array {
  const { map } = world;
  const distance = new Int8Array(map.width * map.height).fill(127);
  const queue = new Int32Array(distance.length);
  let read = 0;
  let write = 0;

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tile = map.index(x, y);
      const owned = (map.ownership[tile]! & OWNED) !== 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (!map.inBounds(nx, ny)) continue;
        if (((map.ownership[map.index(nx, ny)]! & OWNED) !== 0) !== owned) {
          distance[tile] = 0;
          queue[write++] = tile;
          break;
        }
      }
    }
  }

  while (read < write) {
    const tile = queue[read++]!;
    const nextDistance = distance[tile]! + 1;
    if (nextDistance > TREE_BELT_WIDTH) continue;
    const x = tile % map.width;
    const y = Math.floor(tile / map.width);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (!map.inBounds(nx, ny)) continue;
      const next = map.index(nx, ny);
      if (distance[next]! <= nextDistance) continue;
      distance[next] = nextDistance;
      queue[write++] = next;
    }
  }
  return distance;
}

function entranceClear(world: World, x: number, y: number): boolean {
  const { entranceX, entranceY } = world.park;
  return entranceX >= 0 && entranceY >= 0 && (x - entranceX) ** 2 + (y - entranceY) ** 2 <= 10 ** 2;
}

function ambientTreeItem(
  world: World,
  tile: number,
  boundary: Int8Array,
  clearAreas: readonly TreeClearArea[],
): SceneryItem | null {
  const map = world.map;
  const x = tile % map.width;
  const y = Math.floor(tile / map.width);
  const surface = map.surface[tile]!;
  if (surface !== Surface.Grass && surface !== Surface.Sand) return null;
  if (entranceClear(world, x, y)) return null;
  if (clearAreas.some((area) => x >= area.x0 && x <= area.x1 && y >= area.y0 && y <= area.y1))
    return null;

  const edgeDistance = Math.min(x, y, map.width - x - 1, map.height - y - 1);
  const ownsTile = (map.ownership[tile]! & OWNED) !== 0;
  const boundaryDistanceAtTile = boundary[tile]!;
  const cluster = valueNoise(x, y, 18, world.seed ^ 0x51ed270b);
  const detail = valueNoise(x, y, 7, world.seed ^ 0x2c1b3c6d);
  const density = cluster * 0.78 + detail * 0.22;

  const ownershipBelt = boundaryDistanceAtTile <= TREE_BELT_WIDTH;
  const mapEdgeBelt = edgeDistance <= TREE_BELT_WIDTH;
  if (ownershipBelt && ownsTile) return null;

  if (mapEdgeBelt || ownershipBelt) {
    if (density < 0.32 || detail < 0.12) return null;
  } else if (ownsTile) {
    if (density < OWNED_INTERIOR_TREE_THRESHOLD) return null;
  } else if (density < 0.57 || detail < 0.3) {
    return null;
  }

  const species = valueNoise(x, y, 42, world.seed ^ 0x79a4f1d3);
  if (surface === Surface.Sand)
    return Math.floor(species * 2) === 0 ? SceneryItem.PalmTree : SceneryItem.CactusTree;
  return GRASS_TREES[Math.min(GRASS_TREES.length - 1, Math.floor(species * GRASS_TREES.length))]!;
}

function occupiedTiles(world: World): Set<number> {
  const map = world.map;
  const occupied = new Set<number>();
  for (const volume of worldOccupancies(world))
    occupied.add(volume.tileY * map.width + volume.tileX);
  return occupied;
}

function placeAmbientTree(world: World, x: number, y: number, item: SceneryItem): boolean {
  const { map } = world;
  const tile = map.index(x, y);
  const base = map.heights[tile]! + (map.slope[tile] ? 1 : 0);
  const clearance = Math.min(MAX_ELEMENT_BASE, base + Math.max(1, SCENERY_CATALOG[item]!.height));
  return map.addElement(tile, ElementType.SmallScenery, base, clearance, 0, item) >= 0;
}

/** Adds clustered ambient trees to empty tiles without covering existing park elements. */
export function materializeAmbientTrees(
  world: World,
  clearAreas: readonly TreeClearArea[] = [],
): void {
  const map = world.map;
  const occupied = occupiedTiles(world);
  const boundary = boundaryDistance(world);

  for (let tile = 0; tile < map.width * map.height; tile++) {
    if (occupied.has(tile)) continue;
    const x = tile % map.width;
    const y = Math.floor(tile / map.width);
    const item = ambientTreeItem(world, tile, boundary, clearAreas);
    if (item !== null && placeAmbientTree(world, x, y, item)) occupied.add(tile);
  }
}

/** Reconstructs the exact ambient trees that older renderers drew, skipping occupied tiles. */
export function migrateLegacyAmbientTrees(world: World): void {
  const map = world.map;
  const occupied = occupiedTiles(world);

  for (let tile = 0; tile < map.width * map.height; tile++) {
    if (occupied.has(tile)) continue;
    const x = tile % map.width;
    const y = Math.floor(tile / map.width);
    const item = legacyAmbientTreeItem(map.surface[tile]!, x, y);
    if (item !== null && placeAmbientTree(world, x, y, item)) occupied.add(tile);
  }
}
