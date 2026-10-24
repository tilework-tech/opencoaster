import type { System } from '../core/system';
import { TILE_UNITS, Z_STEP } from '../core/constants';

const GUEST_SPEED = 12; // fixed-point units per tick (~1.9 tiles/s at 40 ticks/s)

/**
 * Placeholder behaviour: wander towards random target tiles. Real needs, ride choice, queueing
 * and pathfinding replace this body; the data layout in guest-store.ts is the stable contract.
 */
export const guestSystem: System = {
  name: 'guests',
  update(w) {
    const { cols, count } = w.guests;
    const { x, y, z, targetX, targetY } = cols;
    const map = w.map;
    for (let i = 0; i < count; i++) {
      const gx = targetX[i] * TILE_UNITS + (TILE_UNITS >> 1);
      const gy = targetY[i] * TILE_UNITS + (TILE_UNITS >> 1);
      const dx = gx - x[i];
      const dy = gy - y[i];
      if (dx === 0 && dy === 0) {
        targetX[i] = Math.max(
          0,
          Math.min(map.width - 1, ((x[i] / TILE_UNITS) | 0) + w.rng.int(7) - 3),
        );
        targetY[i] = Math.max(
          0,
          Math.min(map.height - 1, ((y[i] / TILE_UNITS) | 0) + w.rng.int(7) - 3),
        );
        continue;
      }
      x[i] += dx > GUEST_SPEED ? GUEST_SPEED : dx < -GUEST_SPEED ? -GUEST_SPEED : dx;
      y[i] += dy > GUEST_SPEED ? GUEST_SPEED : dy < -GUEST_SPEED ? -GUEST_SPEED : dy;
      z[i] = map.heights[map.index((x[i] / TILE_UNITS) | 0, (y[i] / TILE_UNITS) | 0)] * Z_STEP;
    }
  },
};
