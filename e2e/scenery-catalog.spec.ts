import { devices, expect, test } from './support/test';
import type { Page } from './support/test';
import { OWNED } from '../src/sim/map/tile-map';
import type { World } from '../src/sim/core/world';
import { SCENERY_CATALOG, SCENERY_GROUPS, SceneryItem } from '../src/sim/map/scenery';
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

const FIRST_NEW = SceneryItem.SunflowerPatch;

function emptyOwnedTile(world: World): Tile {
  const map = world.map;
  for (let y = 36; y < 50; y++)
    for (let x = 24; x < 40; x++) {
      const index = map.index(x, y);
      if (
        map.waterLevel[index]! <= map.heights[index]! &&
        (map.ownership[index]! & OWNED) !== 0 &&
        map.firstElement(index) < 0 &&
        map.slope[index] === 0
      )
        return { x, y };
    }
  throw new Error('No empty owned tile');
}

async function placedItems(page: Page, tile: Tile): Promise<number[]> {
  return page.evaluate(({ x, y }) => {
    const map = (
      window as unknown as { __map: { sceneryCount: number; sceneryElements: Int32Array } }
    ).__map;
    const found: number[] = [];
    for (let i = 0; i < map.sceneryCount; i++)
      if (map.sceneryElements[i * 5] === x && map.sceneryElements[i * 5 + 1] === y)
        found.push(map.sceneryElements[i * 5 + 4]!);
    return found;
  }, tile);
}

async function choose(page: Page, group: string, name: string, priceCents: number): Promise<void> {
  await page.getByRole('button', { name: group, exact: true }).click();
  await page
    .getByRole('button', { name: `${name}, $${(priceCents / 100).toFixed(2)}`, exact: true })
    .click();
}

async function browseAndPlace(page: Page): Promise<void> {
  await startStarterPark(page);
  const world = createStarterWorld();
  const tile = emptyOwnedTile(world);
  await toolbarTool(page, 'Scenery');

  for (const group of SCENERY_GROUPS) {
    await page.getByRole('button', { name: group.label, exact: true }).click();
    const expected = SCENERY_CATALOG.filter((item) => item.category === group.category);
    await expect(page.locator('.scenery-card')).toHaveCount(expected.length);
    for (const item of expected)
      await expect(
        page.getByRole('button', {
          name: `${item.name}, $${(item.priceCents / 100).toFixed(2)}`,
          exact: true,
        }),
      ).toHaveAttribute('title', new RegExp(item.blurb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  const picks = [
    SceneryItem.Boulder,
    SceneryItem.TieredFountain,
    SceneryItem.GardenStatue,
    SceneryItem.Flagpole,
  ];
  for (const item of picks) {
    const definition = SCENERY_CATALOG[item]!;
    const group = SCENERY_GROUPS.find((entry) => entry.category === definition.category)!;
    await choose(page, group.label, definition.name, definition.priceCents);
    await expect(page.locator('.scenery-detail')).toContainText(definition.name);
    await hoverGameTile(page, world, tile);
    const label = page.locator('.placement-label');
    await expect(label).toHaveAttribute('data-tone', 'ok');
    await expect(label).toContainText(definition.name);
    const before = await hudCashCents(page);
    await clickGameTile(page, world, tile);
    await expect.poll(() => placedItems(page, tile)).toEqual([item]);
    await expect.poll(() => hudCashCents(page)).toBe(before - definition.priceCents);

    await hoverGameTile(page, world, tile);
    await expect(page.locator('.placement-label')).toHaveAttribute('data-tone', 'refused');

    const [x, y] = await tileScreenPoint(page, world, tile);
    await page.keyboard.down('Shift');
    await page.mouse.click(x, y);
    await page.keyboard.up('Shift');
    await expect.poll(() => placedItems(page, tile)).toEqual([]);
  }
}

test('browse the grouped scenery menu and place, refuse and remove new pieces', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await browseAndPlace(page);
});

test.describe('on a phone', () => {
  const { defaultBrowserType: _browser, ...pixel8 } = devices['Pixel 8'];
  void _browser;
  test.use(pixel8);

  test('every new piece can be reached and picked by tapping', async ({ page }) => {
    test.setTimeout(240_000);
    await startStarterPark(page);
    const toolbar = page.locator('.game-toolbar');
    const scenery = toolbar.getByRole('button', { name: 'Scenery', exact: true });
    if (!(await scenery.isVisible()))
      await toolbar.getByRole('button', { name: 'Actions', exact: true }).tap();
    await scenery.tap();
    for (const item of SCENERY_CATALOG.slice(FIRST_NEW)) {
      const group = SCENERY_GROUPS.find((entry) => entry.category === item.category)!;
      await page.getByRole('button', { name: group.label, exact: true }).tap();
      const card = page.getByRole('button', {
        name: `${item.name}, $${(item.priceCents / 100).toFixed(2)}`,
        exact: true,
      });
      await card.tap();
      await expect(card).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.scenery-detail')).toContainText(item.name);
    }
  });
});
