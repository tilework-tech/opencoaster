import { describe, expect, it } from 'vitest';
import { RIDE_CATALOG, RideType } from '../../src/sim/rides/ride-types';
import { RIDE_MODELS } from './models/ride-catalog';
import { personMesh } from './models/people';
import { PHYSICAL_Z, rotatePoint } from './mesh';

const FLAT_RIDES = Object.values(RIDE_CATALOG).filter(
  (ride) =>
    ride.id !== RideType.GoKarts &&
    !ride.usesTrack &&
    (ride.category === 'gentle' || ride.category === 'thrill'),
);

const GUEST_HEIGHT = (() => {
  const z = personMesh(0, 0, 0).flatMap((triangle) => triangle.v.map((point) => point[2]));
  return (Math.max(...z) - Math.min(...z)) / PHYSICAL_Z;
})();

function modelFor(rideName: string) {
  const model = RIDE_MODELS.find((candidate) => candidate.key.endsWith(`/${slug(rideName)}`));
  if (!model) throw new Error(`Missing flat-ride art model: ${rideName}`);
  return model;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

describe('flat-ride art proportions', () => {
  it('keeps each animated ride inside its declared footprint with a small eaves allowance', () => {
    const allowance = 0.08;
    for (const ride of FLAT_RIDES) {
      const model = modelFor(ride.name);
      const width = Math.max(...ride.footprint.map(([x]) => x)) - Math.min(...ride.footprint.map(([x]) => x)) + 1;
      const depth = Math.max(...ride.footprint.map(([, y]) => y)) - Math.min(...ride.footprint.map(([, y]) => y)) + 1;
      for (let frame = 0; frame < model.frames; frame++) {
        const triangles = model.build(frame);
        for (let view = 0; view < 4; view++) {
          const projectedWidth = view % 2 === 0 ? width : depth;
          const projectedDepth = view % 2 === 0 ? depth : width;
          let extentX = 0;
          let extentY = 0;
          for (const triangle of triangles)
            for (const vertex of triangle.v) {
              const [x, y] = rotatePoint(vertex, view);
              const projectedX = (x - y) * 32;
              const projectedY = (x + y) * 16;
              const footprintX = projectedX / 64 + projectedY / 32;
              const footprintY = projectedY / 32 - projectedX / 64;
              extentX = Math.max(extentX, Math.abs(footprintX));
              extentY = Math.max(extentY, Math.abs(footprintY));
            }
          expect(extentX, `${ride.name} frame ${frame} view ${view} footprint x`).toBeLessThanOrEqual(
            projectedWidth / 2 + allowance,
          );
          expect(extentY, `${ride.name} frame ${frame} view ${view} footprint y`).toBeLessThanOrEqual(
            projectedDepth / 2 + allowance,
          );
        }
      }
    }
  });

  it('keeps each ride within its RCT2 guest-height target band', () => {
    const targets: Record<string, readonly [minimum: number, maximum: number]> = {
      'Merry-Go-Round': [3, 4],
      'Swinging Ship': [4, 8],
      'Ferris Wheel': [6, 10],
      Twist: [2, 5],
      'Haunted House': [3, 6],
      'Spiral Slide': [4, 8],
      'Top Spin': [5, 9],
      Enterprise: [5, 9],
      'Observation Tower': [8, 14],
    };
    for (const ride of FLAT_RIDES) {
      const target = targets[ride.name];
      expect(target, `${ride.name} target range`).toBeDefined();
      if (!target) continue;
      const [minimum, maximum] = target;
      const model = modelFor(ride.name);
      const heights = Array.from({ length: model.frames }, (_, frame) =>
        model.build(frame).flatMap((triangle) => triangle.v.map(([, , z]) => z)),
      ).flat();
      const heightInGuestUnits = (Math.max(...heights) - Math.min(...heights)) / GUEST_HEIGHT;
      expect(heightInGuestUnits, `${ride.name} height in guest-heights`).toBeGreaterThanOrEqual(minimum);
      expect(heightInGuestUnits, `${ride.name} height in guest-heights`).toBeLessThanOrEqual(maximum);
    }
  });
});
