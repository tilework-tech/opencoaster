import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { project } from '../src/render/projection';
import { TILE_UNITS, Z_STEP } from '../src/sim/core/constants';
import { World } from '../src/sim/core/world';
import { raiseLand } from '../src/sim/map/land';
import { parseScenarioFile } from '../src/sim/scenario/scenario-file';
import { prepareScenario } from '../src/sim/scenario/scenario-layout';

const starterScenario = parseScenarioFile(
  JSON.parse(
    readFileSync(new URL('../src/sim/scenario/scenarios/starter.json', import.meta.url), 'utf8'),
  ),
);
const CENTRE = { x: 28, y: 42 };
const UNOWNED = { x: 15, y: 40 };

function createStarterWorld(): World {
  const world = new World({
    seed: starterScenario.seed,
    width: starterScenario.mapWidth,
    height: starterScenario.mapHeight,
  });
  prepareScenario(world, starterScenario);
  return world;
}

/** The HUD cash readout in the bottom-left corner. */
async function hudCash(page: Page): Promise<string> {
  const readouts = page.getByText(/^\$[\d,]+\.\d\d$/);
  const count = await readouts.count();
  for (let i = 0; i < count; i++) {
    const box = await readouts.nth(i).boundingBox();
    if (box && box.x < 300 && box.y > 600) return readouts.nth(i).innerText();
  }
  throw new Error('HUD cash readout is missing');
}

async function clickGameTile(
  page: Page,
  world: World,
  tile: { x: number; y: number },
): Promise<void> {
  const game = await page.locator('#game').boundingBox();
  if (!game) throw new Error('Game viewport is missing');
  const camera = await page.evaluate(() => {
    const { x, y, zoom, rotation } = (
      window as unknown as {
        __camera: { x: number; y: number; zoom: number; rotation: 0 | 1 | 2 | 3 };
      }
    ).__camera;
    return { x, y, zoom, rotation };
  });
  const map = world.map;
  const index = map.index(tile.x, tile.y);
  const projected = new Float64Array(2);
  project(
    (tile.x + 0.5) * TILE_UNITS,
    (tile.y + 0.5) * TILE_UNITS,
    map.heights[index]! * Z_STEP,
    map.width,
    map.height,
    camera.rotation,
    projected,
  );
  await page.mouse.click(
    game.x + game.width / 2 + (projected[0]! - camera.x) * camera.zoom,
    game.y + game.height / 2 + (projected[1]! - camera.y) * camera.zoom,
  );
}

async function startStarterPark(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  await page
    .locator('.scenario-card')
    .filter({ hasText: 'Starter Park' })
    .getByRole('button', { name: 'Start', exact: true })
    .click();
  await expect(page.locator('.game-toolbar')).toBeVisible();
}

async function toolbarTool(page: Page, name: string): Promise<void> {
  await page.locator('.game-toolbar').getByRole('button', { name, exact: true }).click();
}

function tip(page: Page): Locator {
  return page.locator('.path-tip');
}

test.describe('footpaths on sloped ground (desktop)', () => {
  test('a footpath placed on raised ground builds with default settings', async ({ page }) => {
    const world = createStarterWorld();
    await startStarterPark(page);
    await toolbarTool(page, 'Land');
    await clickGameTile(page, world, CENTRE);
    await expect(page.locator('.tool-status')).toContainText('Raising land at');
    expect(raiseLand(world.map, CENTRE.x, CENTRE.y, 1, 1)).toBe(true);

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
        `Path placement requested at ${offset.x}, ${offset.y}.`,
      );
      await expect
        .poll(() => hudCash(page), { message: `footpath on the ${name} slope was refused` })
        .not.toBe(before);
    }
  });

  test('a tile that cannot take a footpath says why at the cursor', async ({ page }) => {
    const world = createStarterWorld();
    await startStarterPark(page);
    await toolbarTool(page, 'Footpaths');
    await clickGameTile(page, world, UNOWNED);
    await expect(tip(page)).toBeVisible();
    await expect(tip(page)).toHaveText('You need to own this land before building a footpath.');
  });
});
