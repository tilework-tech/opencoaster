import { expect, test } from '@playwright/test';
import { RENDERERS, ROTATIONS, lateral, ownership, viewSum } from './depth-ownership';

/** A guest standing on a path surface is never hidden by that surface or by terrain. */
const SURFACE_CASES: Array<{
  name: string;
  scene: string;
  at: Array<[number, number, number]>;
  /** Share of the guest that props such as queue ropes may legitimately cross. */
  allowance?: number;
}> = [
  {
    name: 'flat path, back half and front half of a tile',
    scene: 'path-flat',
    at: [
      [8.1, 8.1, 2],
      [8.9, 8.9, 2],
      [8.02, 8.5, 2],
      [7.98, 8.5, 2],
    ],
  },
  {
    name: 'raised path',
    scene: 'path-raised',
    at: [
      [6.1, 8.2, 4],
      [8.8, 8.8, 4],
    ],
  },
  {
    name: 'queue',
    scene: 'path-queue',
    allowance: 0.12,
    at: [
      [8.5, 8.5, 2],
      [7.5, 8.5, 2],
    ],
  },
  {
    name: 'ramp rising along x with a raised piece ahead',
    scene: 'path-slope',
    at: [
      [5.4, 8.5, 2],
      [6.2, 8.5, 2.2],
      [6.9, 8.5, 2.9],
      [7.5, 8.5, 3.5],
      [7.95, 8.5, 3.95],
    ],
  },
  {
    name: 'ramp rising along y',
    scene: 'path-slope-y',
    at: [
      [8.5, 5.4, 2],
      [8.5, 6.5, 2.5],
      [8.5, 7.9, 3.9],
    ],
  },
];

for (const renderer of RENDERERS) {
  for (const rotation of ROTATIONS) {
    test.describe(`${renderer} rotation ${rotation}`, () => {
      test.describe.configure({ timeout: 120_000 });

      for (const item of SURFACE_CASES) {
        test(`guest stays on top of the ${item.name}`, async ({ page }) => {
          const results = await ownership(page, renderer, rotation, item.scene, 'blank', item.at);
          results.forEach((result, index) => {
            const guest = item.at[index]!;
            expect(result.shown, `guest at ${guest}`).toBeGreaterThan(30);
            expect(result.covered, `guest at ${guest} hidden by the surface`).toBeLessThanOrEqual(
              Math.ceil(result.shown * (item.allowance ?? 0.02)),
            );
            expect(result.uncoveredButLost, `guest at ${guest} lost pixels`).toBeLessThanOrEqual(
              Math.ceil(result.shown * 0.02),
            );
          });
        });
      }

      for (const object of ['tree', 'stall', 'bench'] as const) {
        test(`guest and ${object} order by distance from the camera`, async ({ page }) => {
          const objectAt: [number, number] = object === 'bench' ? [8.5, 8.9] : [8.5, 7.5];
          const lane = lateral(rotation);
          const spots: Array<{ guest: [number, number, number]; front: boolean }> = [];
          for (const distance of [0.7, 1.1]) {
            spots.push({
              guest: [objectAt[0] + lane[0] * distance, objectAt[1] + lane[1] * distance, 2],
              front: true,
            });
            spots.push({
              guest: [objectAt[0] - lane[0] * distance, objectAt[1] - lane[1] * distance, 2],
              front: false,
            });
          }
          const results = await ownership(
            page,
            renderer,
            rotation,
            object,
            'path-flat',
            spots.map((spot) => spot.guest),
          );
          let overlapped = 0;
          results.forEach((result, index) => {
            const spot = spots[index]!;
            const [gx, gy] = spot.guest;
            const nearer = viewSum(gx, gy, rotation) > viewSum(objectAt[0], objectAt[1], rotation);
            expect(nearer, 'fixture geometry').toBe(spot.front);
            if (spot.front) {
              expect(result.covered, `guest in front at ${spot.guest}`).toBeLessThanOrEqual(
                Math.ceil(result.shown * 0.02),
              );
            } else if (result.covered + result.coveredButShown >= 12) {
              overlapped++;
              expect(
                result.coveredButShown,
                `guest behind at ${spot.guest} shows through`,
              ).toBeLessThanOrEqual(
                Math.max(6, Math.ceil((result.covered + result.coveredButShown) * 0.05)),
              );
            }
          });
          if (object !== 'bench')
            expect(overlapped, 'the guest overlaps the object when behind').toBeGreaterThan(0);
        });
      }
    });
  }
}
