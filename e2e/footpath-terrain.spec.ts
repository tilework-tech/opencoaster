import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

// Viewport offsets (CSS px from the game canvas origin) of the opening Starter Park view.
// The centre tile is raised first, so its four neighbours are one-level ramps.
const CENTRE = { x: 300, y: 520 };
const ISO_STEP = { x: 32, y: 16 };
const UNOWNED = { x: 120, y: 620 };

async function gameOffset(page: Page, offset: { x: number; y: number }) {
  const game = await page.locator('#game').boundingBox();
  if (!game) throw new Error('Game viewport is missing');
  return { x: game.x + offset.x, y: game.y + offset.y };
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

async function clickGameTile(page: Page, offset: { x: number; y: number }): Promise<void> {
  const point = await gameOffset(page, offset);
  await page.mouse.click(point.x, point.y);
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
    await startStarterPark(page);
    await toolbarTool(page, 'Land');
    await clickGameTile(page, CENTRE);
    await expect(page.locator('.tool-status')).toContainText('Raising land at');

    await toolbarTool(page, 'Footpaths');
    const neighbours = {
      east: { x: CENTRE.x + ISO_STEP.x, y: CENTRE.y + ISO_STEP.y },
      west: { x: CENTRE.x - ISO_STEP.x, y: CENTRE.y - ISO_STEP.y },
      north: { x: CENTRE.x + ISO_STEP.x, y: CENTRE.y - ISO_STEP.y },
    };
    for (const [name, offset] of Object.entries(neighbours)) {
      const before = await hudCash(page);
      await clickGameTile(page, offset);
      await expect
        .poll(() => hudCash(page), { message: `footpath on the ${name} slope was refused` })
        .not.toBe(before);
    }
  });

  test('a tile that cannot take a footpath says why at the cursor', async ({ page }) => {
    await startStarterPark(page);
    await toolbarTool(page, 'Footpaths');
    await clickGameTile(page, UNOWNED);
    await expect(tip(page)).toBeVisible();
    await expect(tip(page)).toHaveText('You need to own this land before building a footpath.');
  });
});
