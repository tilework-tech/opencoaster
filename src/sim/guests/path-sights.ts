import type { World } from '../core/world';
import { TILE_SHIFT } from '../core/constants';
import { ElementType, isPathElementBroken, PathFlag } from '../map/tile-map';
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

interface TileCounts {
  litterCount: number;
  newestOrder: number;
  map: World['map'];
  version: number;
  /** Per tile: `version << 4 | vomit << 2 | trash`; the counts are valid while the version matches. */
  litterInfo: Uint32Array;
  /** Per tile: `map revision << 1 | vandalised`; valid while the revision matches. */
  brokenInfo: Uint32Array;
  /** Map revision at which `anyBroken` was last worked out. */
  brokenScanRevision: number;
  /** Whether any path addition is vandalised, so tiles need checking at all. */
  anyBroken: boolean;
}

const MAX_LITTER_VERSION = 0x0fffffff;
const countsByWorld = new WeakMap<World, TileCounts>();
let lastWorld: World | null = null;
let lastCounts: TileCounts | null = null;

/** Whether the path addition on `tile` is vandalised, cached per tile until the map changes. */
function isVandalised(counts: TileCounts, tile: number): boolean {
  const map = counts.map;
  if (counts.brokenScanRevision !== map.revision) {
    counts.brokenScanRevision = map.revision;
    counts.anyBroken = false;
    for (let element = 0; element < map.elementCapacity && !counts.anyBroken; element++)
      counts.anyBroken =
        map.elType[element] === ElementType.Path && isPathElementBroken(map, element);
  }
  if (!counts.anyBroken) return false;
  const stamp = (map.revision + 1) & 0x7fffffff;
  const info = counts.brokenInfo[tile];
  if (info >>> 1 === stamp) return (info & 1) !== 0;
  const element = map.pathElement(tile, -1);
  const broken =
    element >= 0 &&
    (map.elFlags[element] & (PathFlag.Bench | PathFlag.Bin | PathFlag.Lamp)) !== 0 &&
    isPathElementBroken(map, element);
  counts.brokenInfo[tile] = (stamp << 1) | (broken ? 1 : 0);
  return broken;
}

/** Per-tile litter and vomit counts, rebuilt from the litter store when it changes. */
function tileCounts(world: World): TileCounts {
  const { map, litter } = world;
  const size = map.width * map.height;
  const newestOrder = litter.count === 0 ? 0 : litter.cols.birthOrder[litter.count - 1];
  let counts = lastWorld === world ? lastCounts! : countsByWorld.get(world);
  if (
    counts &&
    counts.litterCount === litter.count &&
    counts.newestOrder === newestOrder &&
    counts.map === map
  ) {
    lastWorld = world;
    lastCounts = counts;
    return counts;
  }
  if (!counts || counts.map !== map || counts.litterInfo.length !== size) {
    counts = {
      litterCount: 0,
      newestOrder: 0,
      map,
      version: 0,
      litterInfo: new Uint32Array(size),
      brokenInfo: new Uint32Array(size),
      brokenScanRevision: -1,
      anyBroken: false,
    };
    countsByWorld.set(world, counts);
  }
  if (counts.version === MAX_LITTER_VERSION) {
    counts.litterInfo.fill(0);
    counts.version = 0;
  }
  const version = ++counts.version;
  for (let slot = 0; slot < litter.count; slot++) {
    const x = litter.cols.x[slot] >> TILE_SHIFT;
    const y = litter.cols.y[slot] >> TILE_SHIFT;
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
    const tile = y * map.width + x;
    const info = counts.litterInfo[tile];
    const held = info >>> 4 === version ? info & 15 : 0;
    const shift = litter.cols.kind[slot] === LitterKind.Vomit ? 2 : 0;
    const count = (held >> shift) & 3;
    const next = count < PATH_SIGHT_TILE_CAP ? held + (1 << shift) : held;
    counts.litterInfo[tile] = (version << 4) | next;
  }
  counts.litterCount = litter.count;
  counts.newestOrder = newestOrder;
  lastWorld = world;
  lastCounts = counts;
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
  const vandalised = isVandalised(counts, tile);
  const info = counts.litterInfo[tile];
  const seen = info >>> 4 === counts.version ? info & 15 : 0;
  const trash = seen & 3;
  const vomit = seen >> 2;
  const memory = g.sightMemory[slot];
  if (memory === 0 && trash === 0 && vomit === 0 && !vandalised) return;
  let litterSeen = memory & 0xff;
  let disgustSeen = (memory >>> 8) & 0xff;
  let vandalSeen = (memory >>> 16) & 0xff;
  let loss = 0;

  if (trash !== 0 || litterSeen !== 0) {
    litterSeen = advance(world, litterSeen, trash);
    if (
      historySum(litterSeen) >= PATH_SIGHT_THRESHOLD &&
      world.rng.int(0x10000) <= BAD_LITTER_ROLL
    ) {
      recordThought(world, slot, GuestThought.BadLitter);
      loss += PATH_SIGHT_HAPPINESS_LOSS;
      litterSeen |= TIMER_FULL;
    }
  }
  if (vomit !== 0 || disgustSeen !== 0) {
    disgustSeen = advance(world, disgustSeen, vomit);
    if (
      historySum(disgustSeen) >= PATH_SIGHT_THRESHOLD &&
      world.rng.int(0x10000) <= BAD_LITTER_ROLL
    ) {
      recordThought(world, slot, GuestThought.PathDisgusting);
      loss += PATH_SIGHT_HAPPINESS_LOSS;
      disgustSeen |= TIMER_FULL;
    }
  }
  if (vandalised || vandalSeen !== 0) {
    let cooldown = vandalSeen >> TIMER_SHIFT;
    if (cooldown > 0 && world.rng.int(0x10000) <= SIGHT_FADE_ROLL) cooldown--;
    const tiles = ((vandalSeen << 1) | (vandalised ? 1 : 0)) & HISTORY_MASK;
    if (popcount(tiles) >= VANDALISM_SIGHT_THRESHOLD && cooldown === 0) {
      cooldown = VANDALISM_COOLDOWN;
      if (world.rng.int(0x10000) <= BAD_LITTER_ROLL) {
        recordThought(world, slot, GuestThought.Vandalism);
        loss += PATH_SIGHT_HAPPINESS_LOSS;
      }
    }
    vandalSeen = (cooldown << TIMER_SHIFT) | tiles;
  }

  g.sightMemory[slot] = litterSeen | (disgustSeen << 8) | (vandalSeen << 16);
  if (loss > 0) g.happinessTarget[slot] = Math.max(0, g.happinessTarget[slot] - loss);
}

function popcount(value: number): number {
  let n = 0;
  for (let v = value & HISTORY_MASK; v !== 0; v &= v - 1) n++;
  return n;
}
