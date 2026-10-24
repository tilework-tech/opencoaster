import type { TileMap } from '../map/tile-map';

/**
 * Pathfinding contract. Implementations must be deterministic (stable tie-breaking), must not
 * allocate per call (write into `out`), and should be budgeted: guests request paths rarely and
 * results are cached/shared where possible.
 */
export interface Pathfinder {
  /**
   * Writes tile indices (map.index) from `from` (exclusive) to `to` (inclusive) into `out`.
   * Returns the number of steps written, or -1 if unreachable / `out` too small.
   */
  findPath(map: TileMap, from: number, to: number, out: Int32Array): number;
}

export const nullPathfinder: Pathfinder = {
  findPath: () => -1,
};
