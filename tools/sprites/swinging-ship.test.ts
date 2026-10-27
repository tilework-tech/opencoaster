import { describe, expect, it } from 'vitest';
import { rotatePoint } from './mesh';
import type { Vec3 } from './mesh';
import { ramp } from './palette';
import { SHIP_AXLE_Z, SHIP_SWING_DEGREES, swingingShip, swingingShipSeats } from './models/flat-rides';

const hullRamps = [ramp('red'), ramp('brick')];
const PLATFORM_TOP = 0.07;
const HULL_SIDE_CLEARANCE = 0.06;

function hullVertices(frame: number): Vec3[] {
  return swingingShip(frame)
    .filter((triangle) => hullRamps.includes(triangle.material.ramp))
    .flatMap((triangle) => triangle.v);
}

describe('swinging ship pendulum', () => {
  it('uses a smooth profile that builds to the full pose range and settles level', () => {
    expect(SHIP_SWING_DEGREES.length).toBeGreaterThanOrEqual(40);
    expect(SHIP_SWING_DEGREES[0]).toBe(0);
    expect(Math.max(...SHIP_SWING_DEGREES)).toBe(50);
    expect(Math.min(...SHIP_SWING_DEGREES)).toBe(-50);
    expect(SHIP_SWING_DEGREES.at(-1)).toBe(0);
  });

  it('keeps the hull outside the support-frame sides and above the platform for every pose and view', () => {
    for (let frame = 0; frame < SHIP_SWING_DEGREES.length; frame++) {
      const hull = hullVertices(frame);
      for (let view = 0; view < 4; view++) {
        const turned = hull.map((vertex) => rotatePoint(vertex, view));
        const across = turned.map(([x]) => Math.abs(x));
        const bottom = Math.min(...turned.map(([, , z]) => z));
        expect(Math.max(...across), `frame ${frame}, view ${view}`).toBeLessThanOrEqual(
          0.44 - HULL_SIDE_CLEARANCE,
        );
        expect(bottom, `frame ${frame}, view ${view}`).toBeGreaterThan(PLATFORM_TOP);
      }
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
});
