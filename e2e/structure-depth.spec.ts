import { expect, test } from '@playwright/test';
import { RENDERERS, ROTATIONS, ownership, viewSum } from './depth-ownership';

/**
 * A guest walking along the path through a structure on tile (8, 8): behind it, between its
 * pillars and walls, and in front of it. `ground` is the same scene without the structure, so
 * only the structure's pixels count as covering the guest. Scenes ending in `-trees` add an oak
 * tree on each of the six tiles beside the structure, which must not change the outcome.
 */

const CENTRE: [number, number] = [8.5, 8.5];
const WALK: Array<[number, number, number]> = [
  [8.5, 7.1, 2],
  [8.5, 7.7, 2],
  [8.5, 8.2, 2],
  [8.5, 8.5, 2],
  [8.5, 8.8, 2],
  [8.5, 9.3, 2],
  [8.5, 9.9, 2],
];

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
            const results = await ownership(
              page,
              renderer,
              rotation,
              sceneName,
              trees ? 'trees-only' : 'path-column',
              WALK,
            );
            let hiddenBehindFront = 0;
            results.forEach((result, index) => {
              const guest = WALK[index]!;
              const depth =
                viewSum(guest[0], guest[1], rotation) - viewSum(CENTRE[0], CENTRE[1], rotation);
              if (depth > 0.9) {
                expect(result.covered, `guest in front at ${guest}`).toBeLessThanOrEqual(
                  Math.ceil(result.shown * 0.02),
                );
              } else if (depth < -0.9) {
                expect(
                  result.coveredButShown,
                  `guest behind at ${guest} shows through`,
                ).toBeLessThanOrEqual(
                  Math.max(6, Math.ceil((result.covered + result.coveredButShown) * 0.05)),
                );
              } else {
                expect(result.shown, `guest inside at ${guest} is visible`).toBeGreaterThan(30);
                expect(
                  result.uncoveredButLost,
                  `guest inside at ${guest} lost pixels`,
                ).toBeLessThanOrEqual(Math.ceil(result.shown * 0.02));
                if (result.covered > 0) hiddenBehindFront++;
              }
            });
            expect(
              hiddenBehindFront,
              'the front face hides part of a guest inside',
            ).toBeGreaterThan(0);
          });
        }
      }
    });
  }
}
