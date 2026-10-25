/** Deterministic integer hash to [0, 1). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Cell lookup for periodic jittered-grid Voronoi cells over the unit square, so a pattern tiles
 * seamlessly across adjacent map tiles. Returns the cell id and the distance gap between the
 * nearest and second-nearest feature points (small near cell borders).
 */
export function voronoi(
  u: number,
  v: number,
  cells: number,
  seed: number,
): { id: number; gap: number } {
  const x = (((u + 0.5) % 1) + 1) % 1;
  const y = (((v + 0.5) % 1) + 1) % 1;
  const cx = Math.floor(x * cells);
  const cy = Math.floor(y * cells);
  let best = Infinity;
  let second = Infinity;
  let id = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const gx = cx + dx;
      const gy = cy + dy;
      const wx = ((gx % cells) + cells) % cells;
      const wy = ((gy % cells) + cells) % cells;
      const fx = (gx + 0.15 + 0.7 * hash2(wx, wy, seed)) / cells;
      const fy = (gy + 0.15 + 0.7 * hash2(wx, wy, seed + 17)) / cells;
      const d = Math.hypot(x - fx, y - fy);
      if (d < best) {
        second = best;
        best = d;
        id = wy * cells + wx;
      } else if (d < second) second = d;
    }
  }
  return { id, gap: (second - best) * cells };
}
