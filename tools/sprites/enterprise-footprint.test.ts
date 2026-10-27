import { describe, expect, it } from 'vitest';
import { enterprise, enterpriseSeats } from './models/flat-rides';

const PLATFORM_RADIUS = 1.7;
const PLATFORM_TOP = 0.11;
/** A car body hangs this far below its seat point. */
const CAR_DROP = 0.14;

describe('Enterprise cars', () => {
  it('stay over the platform in every frame', () => {
    for (let frame = -1; frame < 8; frame++) {
      const above = enterprise(frame)
        .flatMap((triangle) => triangle.v)
        .filter((p) => p[2] > PLATFORM_TOP + 0.01);
      const reach = Math.max(...above.map((p) => Math.hypot(p[0], p[1])));
      expect(reach, `frame ${frame}`).toBeLessThanOrEqual(PLATFORM_RADIUS);
    }
  });

  it('clear the platform surface at the bottom of the wheel', () => {
    for (let frame = 0; frame < 8; frame++)
      for (const seat of enterpriseSeats(frame))
        expect(seat[2] - CAR_DROP, `frame ${frame}`).toBeGreaterThanOrEqual(PLATFORM_TOP);
  });
});
