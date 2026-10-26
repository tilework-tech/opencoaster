import type { World } from '../core/world';
import { TILE_UNITS } from '../core/constants';
import {
  isPathElementBroken,
  PATH_ADDITION_BROKEN,
  PATH_BOARDING_MARKS,
  PathFlag,
} from '../map/tile-map';

export const enum LitterKind {
  Trash = 0,
  Vomit = 1,
}

export const LITTER_LIMIT = 500;

function evictNewestLitter(w: World): void {
  const litter = w.litter;
  let newest = -1;
  let newestOrder = -1;
  for (let slot = 0; slot < litter.count; slot++) {
    const order = litter.cols.birthOrder[slot];
    if (order > newestOrder) {
      newest = slot;
      newestOrder = order;
    }
  }
  if (newest >= 0) litter.despawnSlot(newest);
}

function assignBirthOrder(w: World, slot: number): void {
  const litter = w.litter;
  let greatest = 0;
  for (let current = 0; current < litter.count; current++)
    greatest = Math.max(greatest, litter.cols.birthOrder[current]);
  if (greatest < 0xffff_fffe) {
    litter.cols.birthOrder[slot] = greatest + 1;
    return;
  }
  const slots = Array.from({ length: litter.count }, (_, index) => index);
  slots.sort((a, b) => litter.cols.birthOrder[a] - litter.cols.birthOrder[b]);
  for (let order = 0; order < slots.length; order++)
    litter.cols.birthOrder[slots[order]] = order + 1;
  litter.cols.birthOrder[slot] = litter.count + 1;
}

export function dropLitter(w: World, x: number, y: number, kind: LitterKind): boolean {
  if (!w.map.inBounds(x, y)) return false;
  const tile = w.map.index(x, y);
  if (!w.map.isWalkable(tile) || w.map.isQueue(tile)) return false;
  const element = w.map.pathElement(tile, -1);
  if (
    kind === LitterKind.Trash &&
    element >= 0 &&
    (w.map.elFlags[element] & PathFlag.Bin) !== 0 &&
    !isPathElementBroken(w.map, element)
  ) {
    const brokenBit = w.map.elData[element] & PATH_ADDITION_BROKEN;
    let corners = w.map.elData[element] & 0xff;
    if (corners !== 0) {
      for (let corner = 0; corner < 4; corner++) {
        const shift = corner * 2;
        const value = (corners >> shift) & 3;
        if (value > 0 && w.rng.int(8) === 0) corners -= 1 << shift;
      }
      w.map.elData[element] = brokenBit | corners | (w.map.elData[element] & PATH_BOARDING_MARKS);
      return true;
    }
  }
  while (w.litter.count >= LITTER_LIMIT) evictNewestLitter(w);
  const slot = w.litter.spawn();
  if (slot < 0) return false;
  assignBirthOrder(w, slot);
  w.litter.cols.x[slot] = x * TILE_UNITS + (TILE_UNITS >> 1);
  w.litter.cols.y[slot] = y * TILE_UNITS + (TILE_UNITS >> 1);
  w.litter.cols.z[slot] = w.map.heightAt(w.litter.cols.x[slot], w.litter.cols.y[slot]);
  w.litter.cols.kind[slot] = kind;
  return true;
}

export const LITTER_SCHEMA = {
  x: Int32Array,
  y: Int32Array,
  z: Int32Array,
  kind: Uint8Array,
  age: Uint16Array,
  birthOrder: Uint32Array,
} as const;
