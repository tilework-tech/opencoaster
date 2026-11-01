import { devices, expect, test } from './support/test';
import type { Page } from './support/test';
import { OWNED } from '../src/sim/map/tile-map';
import type { World } from '../src/sim/core/world';
import {
  clickGameTile,
  createStarterWorld,
  hoverGameTile,
  hudCashCents,
  startStarterPark,
  tileScreenPoint,
  toolbarTool,
} from './footpath-helpers';
import type { Tile } from './footpath-helpers';

const OAK_PRICE_CENTS = 150;

const CENTRE: Tile = { x: 28, y: 42 };

/** The nearest tile to `near` (searching outward) that passes `accept`, so it is on screen. */
function nearestTile(world: World, near: Tile, accept: (index: number) => boolean): Tile {
  const map = world.map;
  for (let radius = 0; radius < 12; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = near.x + dx;
        const y = near.y + dy;
        if (x < 2 || y < 2 || x >= map.width - 2 || y >= map.height - 2) continue;
        if (accept(map.index(x, y))) return { x, y };
      }
    }
  }
  throw new Error(`No suitable tile near ${near.x}, ${near.y}`);
}

/** An owned, dry, empty tile, so a scenery placement can succeed. */
function findOwnedEmptyTile(world: World): Tile {
  const map = world.map;
  return nearestTile(
    world,
    CENTRE,
    (index) =>
      map.waterLevel[index]! <= map.heights[index]! &&
      (map.ownership[index]! & OWNED) !== 0 &&
      map.firstElement(index) < 0,
  );
}

/** An unowned tile, which scenery placement must refuse. */
function findUnownedTile(world: World): Tile {
  const map = world.map;
  return nearestTile(world, CENTRE, (index) => (map.ownership[index]! & OWNED) === 0);
}

async function openScenery(page: Page): Promise<void> {
  await toolbarTool(page, 'Scenery');
  await expect(
    page.getByRole('button', { name: 'Rotate scenery piece', exact: true }),
  ).toBeVisible();
}

test.describe('scenery placement preview', () => {
  test('shows a priced ghost on owned land and places exactly what it showed', async ({ page }) => {
    await startStarterPark(page);
    const world = createStarterWorld();
    const tile = findOwnedEmptyTile(world);
    await openScenery(page);
    const before = await hudCashCents(page);

    await hoverGameTile(page, world, tile);
    const label = page.locator('.placement-label');
    await expect(label).toBeVisible();
    await expect(label).toHaveAttribute('data-tone', 'ok');
    await expect(label).toContainText('Oak tree');
    await expect(label).toContainText('$1.50');
    await page.screenshot({ path: test.info().outputPath('placement-scenery-ok.png') });
    const [px, py] = await tileScreenPoint(page, world, tile);
    await page.screenshot({
      path: test.info().outputPath('placement-scenery-ok-close.png'),
      clip: { x: px - 120, y: py - 120, width: 240, height: 240 },
    });

    await clickGameTile(page, world, tile);
    await expect.poll(() => hudCashCents(page)).toBe(before - OAK_PRICE_CENTS);
  });

  test('turns red with the reason on unowned land and places nothing', async ({ page }) => {
    await startStarterPark(page);
    const world = createStarterWorld();
    const tile = findUnownedTile(world);
    await openScenery(page);
    const before = await hudCashCents(page);

    await hoverGameTile(page, world, tile);
    const label = page.locator('.placement-label');
    await expect(label).toHaveAttribute('data-tone', 'refused');
    await expect(label).toHaveText('Buy this land first.');
    await page.screenshot({ path: test.info().outputPath('placement-scenery-refused.png') });
    const [px, py] = await tileScreenPoint(page, world, tile);
    await page.screenshot({
      path: test.info().outputPath('placement-scenery-refused-close.png'),
      clip: { x: px - 120, y: py - 120, width: 240, height: 240 },
    });

    await clickGameTile(page, world, tile);
    await page.waitForTimeout(500);
    expect(await hudCashCents(page)).toBe(before);
  });
});

test.describe('scenery placement preview on Pixel 8', () => {
  const { defaultBrowserType: _browserType, ...pixel8 } = devices['Pixel 8'];
  void _browserType;
  test.use(pixel8);

  test('shows the ghost label under the pointer on a touch device', async ({ page }) => {
    await startStarterPark(page);
    const world = createStarterWorld();
    const tile = findOwnedEmptyTile(world);
    await openScenery(page);
    await hoverGameTile(page, world, tile);
    await expect(page.locator('.placement-label')).toHaveAttribute('data-tone', 'ok');
    await page.screenshot({ path: test.info().outputPath('placement-scenery-pixel8.png') });
  });
});
