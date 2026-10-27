import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  clickGameTile,
  createStarterWorld,
  findBuildableRun,
  startStarterPark,
  toolbarTool,
} from './footpath-helpers';

async function ghostLevels(page: Page): Promise<Array<{ z: number; dir: number; edges: number }>> {
  return page.$$eval('.path-ghost-tile', (shapes) =>
    shapes.map((shape) => {
      const el = shape as SVGElement;
      return {
        z: Number(el.dataset.z),
        dir: Number(el.dataset.dir),
        edges: Number(el.dataset.edges),
      };
    }),
  );
}

async function press(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: true }).click();
}

test.describe('raised footpaths (piece mode)', () => {
  test('keeps climbing, runs level at the raised height, and comes back down', async ({ page }) => {
    const world = createStarterWorld();
    const run = findBuildableRun(world, 10, { x: 24, y: 42 });
    const ground = world.map.heights[world.map.index(run[0]!.x, run[0]!.y)]!;
    await startStarterPark(page);
    await toolbarTool(page, 'Footpaths');
    await page.getByRole('tab', { name: 'Piece by piece' }).click();
    await clickGameTile(page, world, run[0]!);

    const levels: number[] = [];
    const build = async (slope: 'Up' | 'Level' | 'Down'): Promise<void> => {
      await press(page, slope);
      let z = Number.NaN;
      await expect
        .poll(async () => {
          z = (await ghostLevels(page))[0]?.z ?? Number.NaN;
          return z;
        })
        .toBeGreaterThanOrEqual(0);
      levels.push(z);
      await press(page, 'Build');
      await expect(page.locator('.tool-status')).toContainText('Built at');
    };
    for (let k = 0; k < 4; k++) await build('Up');
    await build('Level');
    await build('Level');
    for (let k = 0; k < 4; k++) await build('Down');

    expect(levels).toEqual([
      ground,
      ground + 1,
      ground + 2,
      ground + 3,
      ground + 4,
      ground + 4,
      ground + 3,
      ground + 2,
      ground + 1,
      ground,
    ]);
  });

  test('Demolish last takes back the newest piece and restores the cursor level', async ({
    page,
  }) => {
    const world = createStarterWorld();
    const run = findBuildableRun(world, 4, { x: 24, y: 42 });
    await startStarterPark(page);
    await toolbarTool(page, 'Footpaths');
    await page.getByRole('tab', { name: 'Piece by piece' }).click();
    await clickGameTile(page, world, run[0]!);
    await press(page, 'Up');
    await press(page, 'Build');
    await press(page, 'Build');
    await expect(page.locator('.tool-status')).toContainText('Built at');
    await press(page, 'Demolish last');
    await expect(page.locator('.tool-status')).toHaveText(
      `Took back the piece at ${run[1]!.x}, ${run[1]!.y}.`,
    );
    await expect
      .poll(async () => (await ghostLevels(page))[0]?.z)
      .toBe(world.map.heights[world.map.index(run[1]!.x, run[1]!.y)]! + 1);
  });
});
