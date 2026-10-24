import type { World } from '../core/world';
import { TILE_UNITS } from '../core/constants';
import { PathFlag } from '../map/tile-map';

export const enum LitterKind {
  Trash = 0,
  Vomit = 1,
}

export function dropLitter(w: World, x: number, y: number, kind: LitterKind): boolean {
  if (!w.map.inBounds(x, y)) return false;
  const tile = w.map.index(x, y);
  if (!w.map.isWalkable(tile)) return false;
  const element = w.map.pathElement(tile, -1);
  if (kind === LitterKind.Trash && element >= 0 && (w.map.elFlags[element] & PathFlag.Bin) !== 0) {
    if (w.map.elData[element] < 12) w.map.elData[element]++;
    return true;
  }
  const slot = w.litter.spawn();
  if (slot < 0) return false;
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
} as const;
