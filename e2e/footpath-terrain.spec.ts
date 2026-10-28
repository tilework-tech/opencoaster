import { expect, test } from './support/test';
import { raiseLand } from '../src/sim/map/land';
import {
  clickGameTile,
  createStarterWorld,
  hoverGameTile,
  hudCash,
  startStarterPark,
  toolbarTool,
} from './footpath-helpers';

const CENTRE = { x: 28, y: 42 };
const UNOWNED = { x: 15, y: 40 };

test.describe('footpaths on sloped ground (desktop)', () => {
  test('a footpath placed on raised ground builds with default settings', async ({ page }) => {
    const world = createStarterWorld();
    await startStarterPark(page);
    await toolbarTool(page, 'Land');
    await clickGameTile(page, world, CENTRE);
    await expect(page.locator('.tool-status')).toContainText('Raising land at');
    expect(raiseLand(world.map, CENTRE.x, CENTRE.y, 1, 1)).toBe(true);
    const centreIndex = CENTRE.y * world.map.width + CENTRE.x;
    await expect
      .poll(() =>
        page.evaluate(
          (index) => (window as unknown as { __map: { heights: Uint8Array } }).__map.heights[index],
          centreIndex,
        ),
      )
      .toBe(world.map.heights[centreIndex]);

    await toolbarTool(page, 'Footpaths');
    const neighbours = {
      east: { x: CENTRE.x + 1, y: CENTRE.y },
      west: { x: CENTRE.x - 1, y: CENTRE.y },
      north: { x: CENTRE.x, y: CENTRE.y - 1 },
    };
    for (const [name, offset] of Object.entries(neighbours)) {
      const before = await hudCash(page);
      await clickGameTile(page, world, offset);
      await expect(page.locator('.tool-status')).toHaveText(
        `Laid footpath at ${offset.x}, ${offset.y} for $10.00.`,
      );
      await expect
        .poll(() => hudCash(page), { message: `footpath on the ${name} slope was refused` })
        .not.toBe(before);
    }
  });

  test('a tile that cannot take a footpath says why at the cursor', async ({ page }) => {
    test.fixme(
      true,
      'Fails on clean main 6f45b2e: the unowned-tile hover leaves the refusal label empty.',
    );
    const world = createStarterWorld();
    await startStarterPark(page);
    await toolbarTool(page, 'Footpaths');
    await hoverGameTile(page, world, UNOWNED);
    await expect(page.locator('.path-ghost-label')).toHaveText(
      'You need to own this land before building a footpath.',
    );
  });
});
