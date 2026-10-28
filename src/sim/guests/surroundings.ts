import type { World } from '../core/world';
import { TILE_SHIFT, Z_STEP } from '../core/constants';
import {
  countScenerySurroundings,
  emptyScenerySurroundings,
  SCENERY_SCAN_WINDOW_TILES,
} from '../map/scenery-effects';
import { GuestState, GuestThought, recordThought } from './guest-store';

/** A guest assesses its surroundings once per 18 idle-motive periods of 512 ticks. */
export const SCENERY_THOUGHT_INTERVAL = 18 * 512;
export const SCENERY_THOUGHT_MIN_COUNT = 40;
export const SCENERY_THOUGHT_MAX_RUBBISH = 8;
export const CLEAN_THOUGHT_MAX_RUBBISH = 2;
export const SURROUNDINGS_HAPPINESS_BONUS = 45;

interface LitterIndex {
  count: number;
  /** Hash of every litter position, so a swap that keeps the count and newest order still rebuilds. */
  signature: number;
  stride: number;
  prefix: Int32Array;
}

const litterIndexByWorld = new WeakMap<World, LitterIndex>();
const surroundingsScratch = emptyScenerySurroundings();

function makeLitterPrefix(world: World): LitterIndex {
  const { width, height } = world.map;
  const stride = width + 1;
  const counts = new Int32Array(width * height);
  for (let slot = 0; slot < world.litter.count; slot++) {
    const x = world.litter.cols.x[slot] >> TILE_SHIFT;
    const y = world.litter.cols.y[slot] >> TILE_SHIFT;
    if (x >= 0 && y >= 0 && x < width && y < height) counts[y * width + x]++;
  }

  const prefix = new Int32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowTotal = 0;
    for (let x = 0; x < width; x++) {
      rowTotal += counts[y * width + x];
      prefix[(y + 1) * stride + x + 1] = prefix[y * stride + x + 1] + rowTotal;
    }
  }
  return { count: world.litter.count, signature: litterSignature(world), stride, prefix };
}

function litterSignature(world: World): number {
  const { x, y } = world.litter.cols;
  let hash = 0;
  for (let slot = 0; slot < world.litter.count; slot++) {
    hash = (Math.imul(hash, 31) + x[slot]) | 0;
    hash = (Math.imul(hash, 31) + y[slot]) | 0;
  }
  return hash;
}

function litterInWindow(world: World, centerX: number, centerY: number): number {
  let index = litterIndexByWorld.get(world);
  const signature = litterSignature(world);
  if (!index || index.count !== world.litter.count || index.signature !== signature) {
    index = makeLitterPrefix(world);
    litterIndexByWorld.set(world, index);
  }
  const radius = Math.floor(SCENERY_SCAN_WINDOW_TILES / 2);
  const x0 = Math.max(0, centerX - radius);
  const y0 = Math.max(0, centerY - radius);
  const x1 = Math.min(world.map.width, centerX - radius + SCENERY_SCAN_WINDOW_TILES);
  const y1 = Math.min(world.map.height, centerY - radius + SCENERY_SCAN_WINDOW_TILES);
  return (
    index.prefix[y1 * index.stride + x1] -
    index.prefix[y0 * index.stride + x1] -
    index.prefix[y1 * index.stride + x0] +
    index.prefix[y0 * index.stride + x0]
  );
}

/** Applies the available surroundings thoughts on the documented 18-tick assessment cadence. */
export function updateGuestSurroundings(world: World, slot: number): void {
  const guests = world.guests.cols;
  if (guests.state[slot] !== GuestState.Wandering) return;
  if ((world.tick + world.guests.slotToId[slot]) % SCENERY_THOUGHT_INTERVAL >= 4) return;

  const tileX = guests.x[slot] >> TILE_SHIFT;
  const tileY = guests.y[slot] >> TILE_SHIFT;
  const surroundings = countScenerySurroundings(
    world.map,
    tileX,
    tileY,
    Math.floor(guests.z[slot] / Z_STEP),
    litterInWindow(world, tileX, tileY),
    surroundingsScratch,
  );
  if (surroundings.suppressed) return;

  const sceneryCount = surroundings.smallScenery + surroundings.largeScenery;
  const thought =
    sceneryCount >= SCENERY_THOUGHT_MIN_COUNT &&
    surroundings.rubbishCount < SCENERY_THOUGHT_MAX_RUBBISH
      ? GuestThought.Scenery
      : surroundings.rubbishCount < CLEAN_THOUGHT_MAX_RUBBISH
        ? GuestThought.VeryClean
        : GuestThought.None;
  if (thought === GuestThought.None) return;

  guests.happinessTarget[slot] = Math.min(
    255,
    guests.happinessTarget[slot] + SURROUNDINGS_HAPPINESS_BONUS,
  );
  recordThought(world, slot, thought);
}
