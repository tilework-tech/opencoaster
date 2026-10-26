import { expect, test } from '@playwright/test';
import { RENDERERS, ROTATIONS, ownership, viewSum } from './depth-ownership';

/**
 * A guest walking along the path through a structure on tile (8, 8): behind it, between its
 * pillars and walls, and in front of it. `ground` is the same scene without the structure, so
 * only the structure's pixels count as covering the guest. Scenes ending in `-trees` add an oak
 * tree on each of the six tiles beside the structure, which must not change the outcome.
 */

/** Distances along the view axis from the structure's tile centre, negative behind it. */
const DEPTHS = [-1.4, -0.8, -0.3, -0.15, 0.15, 0.3, 0.8, 1.4];

/** Offsets across the path, in tiles, at which the guest crosses the structure. */
const LANES = [-0.28, 0, 0.28];

/** World-y step that moves toward the camera in each rotation (the path runs along y). */
const TOWARD_CAMERA = [1, -1, -1, 1];

const STRUCTURES = [
  { name: 'park entrance', scene: 'gate', withTrees: 'gate-trees' },
  { name: 'ride entrance', scene: 'ride-entrance', withTrees: 'ride-entrance-trees' },
  { name: 'ride exit', scene: 'ride-exit', withTrees: 'ride-exit-trees' },
  { name: 'station', scene: 'station-entrance', withTrees: 'station-trees' },
];

for (const renderer of RENDERERS) {
  for (const rotation of ROTATIONS) {
    test.describe(`${renderer} rotation ${rotation}`, () => {
      test.describe.configure({ timeout: 180_000 });

      for (const structure of STRUCTURES) {
        for (const trees of [false, true]) {
          const sceneName = trees ? structure.withTrees : structure.scene;
          test(`guest walking through the ${structure.name}${trees ? ' with trees beside it' : ''}`, async ({
            page,
          }) => {
            const walk = LANES.flatMap((lane) =>
              DEPTHS.map((d): [number, number, number] => [
                8.5 + lane,
                8.5 + d * TOWARD_CAMERA[rotation]!,
                2,
              ]),
            );
            const results = await ownership(
              page,
              renderer,
              rotation,
              sceneName,
              trees ? 'trees-only' : 'path-column',
              walk,
            );
            let hiddenBehindFront = 0;
            results.forEach((result, index) => {
              const guest = walk[index]!;
              const depth =
                viewSum(guest[0], guest[1], rotation) -
                viewSum(8.5 + guest[0] - guest[0], 8.5, rotation);
              const at = `guest at ${guest[0]},${guest[1].toFixed(2)}`;
              if (depth > 0.7) {
                expect(result.covered, `${at} in front`).toBeLessThanOrEqual(
                  Math.ceil(result.shown * 0.02),
                );
              } else if (depth < -0.7) {
                expect(result.coveredButShown, `${at} behind shows through`).toBeLessThanOrEqual(
                  Math.max(6, Math.ceil((result.covered + result.coveredButShown) * 0.05)),
                );
              } else if (result.covered > 24) hiddenBehindFront++;
            });
            expect(
              hiddenBehindFront,
              'the structure hides part of a guest inside it',
            ).toBeGreaterThan(0);
          });
        }
      }
    });
  }
}
