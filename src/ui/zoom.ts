/** Discrete camera zoom ladder. Four levels; the scale ratios are tuning values, not original data. */
export const ZOOM_LEVELS: readonly number[] = [0.5, 1, 2, 4];
export const DEFAULT_ZOOM = 1;

function nearestIndex(zoom: number): number {
  let best = 0;
  for (let i = 1; i < ZOOM_LEVELS.length; i++)
    if (Math.abs(Math.log(ZOOM_LEVELS[i] / zoom)) < Math.abs(Math.log(ZOOM_LEVELS[best] / zoom)))
      best = i;
  return best;
}

/** One level in (+1) or out (-1) from the level nearest `zoom`. */
export function stepZoom(zoom: number, direction: -1 | 1): number {
  const next = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, nearestIndex(zoom) + direction));
  return ZOOM_LEVELS[next];
}
