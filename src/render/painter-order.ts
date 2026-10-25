import { TILE_UNITS } from '../sim/core/constants';
import type { MapData } from './renderer';
import type { Rotation } from './projection';

let counts = new Int32Array(1024);

/**
 * Writes the indices `[0, count)` of `keys` into `order` sorted by ascending key, keeping equal
 * keys in index order. Counting sort over the key range: linear time and no allocation once the
 * count table has grown to the frame's depth range.
 */
export function sortByDepth(keys: Int32Array, count: number, order: Int32Array): void {
  if (count === 0) return;
  let min = keys[0];
  let max = keys[0];
  for (let i = 1; i < count; i++) {
    const key = keys[i];
    if (key < min) min = key;
    else if (key > max) max = key;
  }
  const range = max - min + 1;
  if (range > counts.length) counts = new Int32Array(Math.max(range, counts.length * 2));
  counts.fill(0, 0, range + 1);
  for (let i = 0; i < count; i++) counts[keys[i] - min + 1]++;
  for (let i = 1; i <= range; i++) counts[i] += counts[i - 1];
  for (let i = 0; i < count; i++) order[counts[keys[i] - min]++] = i;
}

/**
 * View-space tile-diagonal coordinate (tile units) of a world point: larger is nearer the
 * camera. Every renderer's painter depth is twice this, less the height level.
 */
export function rotatedPositionSum(x: number, y: number, map: MapData, rotation: Rotation): number {
  const tx = x / TILE_UNITS;
  const ty = y / TILE_UNITS;
  switch (rotation) {
    case 0:
      return tx + ty;
    case 1:
      return map.height - ty + tx;
    case 2:
      return map.width - tx + map.height - ty;
    case 3:
      return ty + map.width - tx;
  }
}
