import type { World } from '../core/world';
import { TILE_SHIFT } from '../core/constants';
import { isPathElementBroken, PathFlag } from '../map/tile-map';
import { GuestThought, recordThought } from './guest-store';
import { LitterKind } from './litter-store';

/** A thought fires when a roll below this, out of 65,536, succeeds: about one step in six. */
export const BAD_LITTER_ROLL = 10_922;
/** Chance per step, out of 65,536, that a recalled sighting fades (about one in fifteen). */
export const SIGHT_FADE_ROLL = 4_369;
export const PATH_SIGHT_HAPPINESS_LOSS = 17;
/** Pieces counted on one tile are capped here. */
export const PATH_SIGHT_TILE_CAP = 3;
/** Litter or vomit across the last three tiles needed to complain. */
export const PATH_SIGHT_THRESHOLD = 3;
/** Vandalised tiles among the last six needed to complain. */
export const VANDALISM_SIGHT_THRESHOLD = 2;
const VANDALISM_COOLDOWN = 3;
const TIMER_SHIFT = 6;
const TIMER_FULL = 3 << TIMER_SHIFT;
const HISTORY_MASK = 0x3f;
const LITTER_BIT = 0;
const VOMIT_BIT = 1;

interface TileCounts {
  litterCount: number;
  newestOrder: number;
  width: number;
  trash: Uint8Array;
  vomit: Uint8Array;
}

const countsByWorld = new WeakMap<World, TileCounts>();

function tileCounts(world: World): TileCounts {
  const { width, height } = world.map;
  const litter = world.litter;
  const newestOrder = litter.count === 0 ? 0 : litter.cols.birthOrder[litter.count - 1];
  let counts = countsByWorld.get(world);
  if (
    counts &&
    counts.litterCount === litter.count &&
    counts.newestOrder === newestOrder &&
    counts.width === width
  )
    return counts;
  counts = {
    litterCount: litter.count,
    newestOrder,
    width,
    trash: new Uint8Array(width * height),
    vomit: new Uint8Array(width * height),
  };
  for (let slot = 0; slot < litter.count; slot++) {
    const x = litter.cols.x[slot] >> TILE_SHIFT;
    const y = litter.cols.y[slot] >> TILE_SHIFT;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const bucket = litter.cols.kind[slot] === LitterKind.Vomit ? counts.vomit : counts.trash;
    const tile = y * width + x;
    if (bucket[tile] < PATH_SIGHT_TILE_CAP) bucket[tile]++;
  }
  countsByWorld.set(world, counts);
  return counts;
}

function historySum(history: number): number {
  return (history & 3) + ((history >> 2) & 3) + ((history >> 4) & 3);
}

/** Shifts a new tile's count into the history, fading a recalled sighting now and then. */
function advance(world: World, history: number, count: number): number {
  let timer = history & TIMER_FULL;
  if (timer !== 0 && world.rng.int(0x10000) <= SIGHT_FADE_ROLL) timer -= 1 << TIMER_SHIFT;
  return timer | (((history << 2) | count) & HISTORY_MASK);
}

/**
 * Notes what a guest sees on arriving at a path tile. Three pieces of litter, or three of vomit,
 * across the last three tiles, or vandalism on two of the last six, give a one-in-six chance of a
 * complaint that also lowers the guest's happiness target.
 */
export function noteTileSights(world: World, slot: number, tile: number): void {
  const g = world.guests.cols;
  const counts = tileCounts(world);
  const target = g.happinessTarget[slot];

  g.litterSeen[slot] = advance(world, g.litterSeen[slot], counts.trash[tile]);
  g.disgustSeen[slot] = advance(world, g.disgustSeen[slot], counts.vomit[tile]);

  const complaints: Array<[number, GuestThought, number]> = [
    [LITTER_BIT, GuestThought.BadLitter, g.litterSeen[slot]],
    [VOMIT_BIT, GuestThought.PathDisgusting, g.disgustSeen[slot]],
  ];
  let loss = 0;
  for (const [bit, thought, history] of complaints) {
    if (historySum(history) < PATH_SIGHT_THRESHOLD) continue;
    if (world.rng.int(0x10000) > BAD_LITTER_ROLL) continue;
    recordThought(world, slot, thought);
    loss += PATH_SIGHT_HAPPINESS_LOSS;
    if (bit === LITTER_BIT) g.litterSeen[slot] |= TIMER_FULL;
    else g.disgustSeen[slot] |= TIMER_FULL;
  }

  const element = world.map.pathElement(tile, -1);
  const vandalised =
    element >= 0 &&
    (world.map.elFlags[element] & (PathFlag.Bench | PathFlag.Bin | PathFlag.Lamp)) !== 0 &&
    isPathElementBroken(world.map, element);
  const seen = g.vandalSeen[slot];
  let cooldown = seen >> TIMER_SHIFT;
  if (cooldown > 0 && world.rng.int(0x10000) <= SIGHT_FADE_ROLL) cooldown--;
  const tiles = ((seen << 1) | (vandalised ? 1 : 0)) & HISTORY_MASK;
  const witnessed = popcount(tiles) >= VANDALISM_SIGHT_THRESHOLD && cooldown === 0;
  if (witnessed) {
    cooldown = VANDALISM_COOLDOWN;
    if (world.rng.int(0x10000) <= BAD_LITTER_ROLL) {
      recordThought(world, slot, GuestThought.Vandalism);
      loss += PATH_SIGHT_HAPPINESS_LOSS;
    }
  }
  g.vandalSeen[slot] = (cooldown << TIMER_SHIFT) | tiles;

  if (loss > 0) g.happinessTarget[slot] = Math.max(0, target - loss);
}

function popcount(value: number): number {
  let n = 0;
  for (let v = value & HISTORY_MASK; v !== 0; v &= v - 1) n++;
  return n;
}
