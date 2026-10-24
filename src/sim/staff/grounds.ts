import type { World } from '../core/world';
import { Surface } from '../map/tile-map';
import { charge } from '../economy/api';
import { LedgerCategory } from '../economy/ledger';

/** Low nibble of a `World.grounds` byte: grass overgrowth from 0 (mown) to `OVERGROWTH_MAX`. */
export const OVERGROWTH_MASK = 0x0f;
export const OVERGROWTH_MAX = 15;
/** Overgrowth at or above this is long enough for a handyman to mow. */
export const MOW_THRESHOLD = 8;
/** A planted flower bed on grass. */
export const FLOWER_BED = 0x10;
/** A flower bed that needs watering. */
export const FLOWER_BED_THIRSTY = 0x20;
/** Tunable: one-off charge for planting a flower bed. */
export const FLOWER_BED_COST_CENTS = 300;
/** Ticks between grass growth and flower-bed drying. */
export const GROUNDS_GROW_INTERVAL = 1024;
const DRY_ODDS = 4;

/** Grass that no path runs over: the tiles a handyman mows and a flower bed can be planted on. */
export function isGrassSite(world: World, tile: number): boolean {
  return world.map.surface[tile] === Surface.Grass && !world.map.isWalkable(tile);
}

export function setFlowerBed(world: World, x: number, y: number, enabled: boolean): boolean {
  if (!world.map.inBounds(x, y)) return false;
  const tile = world.map.index(x, y);
  if (!isGrassSite(world, tile) || !world.map.canBuild(tile)) return false;
  const grounds = world.grounds;
  if (!enabled) {
    grounds[tile] = 0;
    return true;
  }
  if ((grounds[tile] & FLOWER_BED) !== 0) return true;
  if (world.economy.cash < FLOWER_BED_COST_CENTS) return false;
  charge(world, LedgerCategory.Landscaping, FLOWER_BED_COST_CENTS);
  grounds[tile] = FLOWER_BED;
  return true;
}

/** Grows grass one step and dries some flower beds, once per growth interval. */
export function growGrounds(world: World): void {
  if (world.tick % GROUNDS_GROW_INTERVAL !== 0) return;
  const grounds = world.grounds;
  const size = world.map.width * world.map.height;
  for (let tile = 0; tile < size; tile++) {
    if (!isGrassSite(world, tile)) continue;
    const value = grounds[tile];
    if ((value & FLOWER_BED) !== 0) {
      if ((value & FLOWER_BED_THIRSTY) === 0 && world.rng.int(DRY_ODDS) === 0) {
        grounds[tile] = value | FLOWER_BED_THIRSTY;
      }
    } else if ((value & OVERGROWTH_MASK) < OVERGROWTH_MAX) {
      grounds[tile] = value + 1;
    }
  }
}

/** Writes every tile that currently needs watering or mowing into `sites`; returns how many. */
export function collectGardenSites(world: World, sites: Int32Array): number {
  const size = world.map.width * world.map.height;
  let count = 0;
  for (let tile = 0; tile < size; tile++) {
    if (needsWatering(world, tile) || needsMowing(world, tile)) sites[count++] = tile;
  }
  return count;
}

export function needsWatering(world: World, tile: number): boolean {
  const value = world.grounds[tile];
  return (
    (value & (FLOWER_BED | FLOWER_BED_THIRSTY)) === (FLOWER_BED | FLOWER_BED_THIRSTY) &&
    isGrassSite(world, tile)
  );
}

export function needsMowing(world: World, tile: number): boolean {
  const value = world.grounds[tile];
  return (
    (value & FLOWER_BED) === 0 &&
    (value & OVERGROWTH_MASK) >= MOW_THRESHOLD &&
    isGrassSite(world, tile)
  );
}

export function waterFlowerBed(world: World, tile: number): void {
  world.grounds[tile] &= ~FLOWER_BED_THIRSTY;
}

export function mowGrass(world: World, tile: number): void {
  world.grounds[tile] &= ~OVERGROWTH_MASK;
}
