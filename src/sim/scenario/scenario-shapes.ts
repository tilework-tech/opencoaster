import type { ScenarioShape } from './scenario';
import type { TileRect } from './scenario-map';

/**
 * Distance in tiles from the point (`px`, `py`) to the shape, 0 inside it. Tile (x, y) covers
 * [x, x + 1] × [y, y + 1], so its centre is (x + 0.5, y + 0.5) and terrain vertex (vx, vy) is the
 * point (vx, vy). Ellipse distances outside the rim are scaled by the smaller radius.
 */
export function shapeDistance(shape: ScenarioShape, px: number, py: number): number {
  if ('rect' in shape) {
    const [x0, y0, x1, y1] = shape.rect;
    const dx = Math.max(x0 + 0.5 - px, px - (x1 + 0.5), 0);
    const dy = Math.max(y0 + 0.5 - py, py - (y1 + 0.5), 0);
    return Math.sqrt(dx * dx + dy * dy);
  }
  if ('ellipse' in shape) {
    const [cx, cy, rx, ry] = shape.ellipse;
    const nx = (px - (cx + 0.5)) / rx;
    const ny = (py - (cy + 0.5)) / ry;
    const n = Math.sqrt(nx * nx + ny * ny);
    return n <= 1 ? 0 : (n - 1) * Math.min(rx, ry);
  }
  const [x0, y0, x1, y1, half] = shape.band;
  const ax = x0 + 0.5;
  const ay = y0 + 0.5;
  const sx = x1 - x0;
  const sy = y1 - y0;
  const len2 = sx * sx + sy * sy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * sx + (py - ay) * sy) / len2));
  const dx = px - (ax + t * sx);
  const dy = py - (ay + t * sy);
  return Math.max(0, Math.sqrt(dx * dx + dy * dy) - half);
}

/** True when the centre of tile (x, y) lies in the shape. */
export function shapeContains(shape: ScenarioShape, x: number, y: number): boolean {
  return shapeDistance(shape, x + 0.5, y + 0.5) === 0;
}

/** Inclusive tile rectangle around the shape. */
export function shapeBounds(shape: ScenarioShape): TileRect {
  if ('rect' in shape) {
    const [x0, y0, x1, y1] = shape.rect;
    return { x0, y0, x1, y1 };
  }
  if ('ellipse' in shape) {
    const [cx, cy, rx, ry] = shape.ellipse;
    return { x0: cx - rx, y0: cy - ry, x1: cx + rx, y1: cy + ry };
  }
  const [x0, y0, x1, y1, half] = shape.band;
  return {
    x0: Math.min(x0, x1) - half,
    y0: Math.min(y0, y1) - half,
    x1: Math.max(x0, x1) + half,
    y1: Math.max(y0, y1) + half,
  };
}
