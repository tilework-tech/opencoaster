import { describe, expect, it } from 'vitest';
import { rotatePoint } from './mesh';
import type { Vec3 } from './mesh';
import {
  SHIP_AXLE_Z,
  SHIP_MAX_SWING_DEGREES,
  SHIP_SWING_DEGREES,
  swingingShipArmEndpoints,
  swingingShipHull,
  swingingShipSeats,
} from './models/flat-rides';
import { model } from './models/rides/swinging-ship';

const PLATFORM_TOP = 0.07;
const HULL_SIDE_CLEARANCE = 0.06;

function hullVertices(frame: number): Vec3[] {
  return swingingShipHull(frame).flatMap((triangle) => triangle.v);
}

describe('swinging ship pendulum', () => {
  it('uses enough poses for smooth motion and builds through repeated passes before settling', () => {
    expect(SHIP_SWING_DEGREES.length).toBeGreaterThanOrEqual(100);
    expect(model.frames).toBe(SHIP_SWING_DEGREES.length + 1);
    expect(SHIP_SWING_DEGREES[0]).toBe(0);
    const peak = Math.max(...SHIP_SWING_DEGREES.map(Math.abs));
    expect(peak).toBe(SHIP_MAX_SWING_DEGREES);
    expect(SHIP_SWING_DEGREES.some((angle) => angle > 0)).toBe(true);
    expect(SHIP_SWING_DEGREES.some((angle) => angle < 0)).toBe(true);
    expect(SHIP_SWING_DEGREES.at(-1)).toBe(0);
    expect(SHIP_SWING_DEGREES.filter((angle) => Math.abs(angle) >= peak * 0.9).length).toBeGreaterThan(2);
  });

  it('keeps the hull outside the support-frame sides and above the platform for every pose and view', () => {
    for (let frame = 0; frame < SHIP_SWING_DEGREES.length; frame++) {
      const hull = hullVertices(frame);
      for (let view = 0; view < 4; view++) {
        const turned = hull.map((vertex) => rotatePoint(vertex, view));
        const across = turned.map((vertex) => Math.abs(vertex[view % 2 === 0 ? 0 : 1]));
        const bottom = Math.min(...turned.map(([, , z]) => z));
        expect(Math.max(...across), `frame ${frame}, view ${view}`).toBeLessThanOrEqual(
          0.44 - 0.035 - HULL_SIDE_CLEARANCE,
        );
        expect(bottom, `frame ${frame}, view ${view}`).toBeGreaterThan(PLATFORM_TOP);
      }
    }
  });

  it('keeps both axle-to-hull arm lengths constant through every pose', () => {
    const reference = swingingShipArmEndpoints(0).map(([pivot, attachment]) =>
      Math.hypot(attachment[0] - pivot[0], attachment[1] - pivot[1], attachment[2] - pivot[2]),
    );
    for (let frame = 1; frame < SHIP_SWING_DEGREES.length; frame++) {
      swingingShipArmEndpoints(frame).forEach(([pivot, attachment], arm) => {
        expect(
          Math.hypot(attachment[0] - pivot[0], attachment[1] - pivot[1], attachment[2] - pivot[2]),
          `frame ${frame}, arm ${arm}`,
        ).toBeCloseTo(reference[arm]!, 10);
      });
    }
  });

  it('keeps every seated rider at a fixed distance from the pivot throughout the swing', () => {
    const reference = swingingShipSeats(0).map(([x, y, z]) =>
      Math.hypot(x, y, z - SHIP_AXLE_Z),
    );
    for (let frame = 1; frame < SHIP_SWING_DEGREES.length; frame++) {
      const seats = swingingShipSeats(frame);
      seats.forEach(([x, y, z], seat) => {
        expect(Math.hypot(x, y, z - SHIP_AXLE_Z), `frame ${frame}, seat ${seat}`).toBeCloseTo(
          reference[seat]!,
          10,
        );
      });
    }
  });

  it('keeps seated riders within the hull width for every pose', () => {
    for (let frame = 0; frame < SHIP_SWING_DEGREES.length; frame++) {
      const swing = (SHIP_SWING_DEGREES[frame]! * Math.PI) / 180;
      for (const [x, y, z] of swingingShipSeats(frame)) {
        const dy = y;
        const dz = z - SHIP_AXLE_Z;
        const localY = dy * Math.cos(swing) + dz * Math.sin(swing);
        const width = 0.34 * (1 - 0.5 * Math.abs(localY / 1.8) ** 3);
        expect(Math.abs(x) + 0.055, `frame ${frame}, seat y ${localY}`).toBeLessThan(width);
      }
    }
  });
});
