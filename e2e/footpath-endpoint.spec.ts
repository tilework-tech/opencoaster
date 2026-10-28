import { expect, test } from './support/test';
import {
  createStarterWorld,
  hudCashCents,
  startStarterPark,
  tileScreenPoint,
  toolbarTool,
} from './footpath-helpers';

// This Starter Park fixture path end is a deliberate scenario contract: it sits at level 2 and
// has one connected edge, so the only open extension direction is -Y.
const END = { x: 26, y: 44 };
const FIRST_PIECE = { x: 26, y: 43 };
const START_LEVEL = 2;

test('locks onto a path end and builds a five-piece raised extension', async ({ page }) => {
  const world = createStarterWorld();
  await startStarterPark(page);
  await toolbarTool(page, 'Footpaths');
  const hint = page.locator('.path-hint');
  await expect(hint).toBeVisible();
  const cashBefore = await hudCashCents(page);

  await page.getByRole('tab', { name: 'Piece by piece' }).click();
  const [endX, endY] = await tileScreenPoint(page, world, END);
  await page.mouse.click(endX, endY);

  await expect(page.getByRole('button', { name: 'Face −Y' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.tool-status')).toContainText('Locked onto path end');
  const ghost = page.locator('.path-ghost-tile');
  await expect(ghost).toHaveCount(1);
  await expect(ghost).toHaveAttribute('data-x', String(FIRST_PIECE.x));
  await expect(ghost).toHaveAttribute('data-y', String(FIRST_PIECE.y));
  await expect(ghost).toHaveAttribute('data-z', String(START_LEVEL));
  await expect(page.locator('.path-height-readout')).toHaveText(`Build height: ${START_LEVEL}`);
  await expect(page.locator('.path-ghost-arrow')).toBeVisible();

  const up = page.getByRole('button', { name: /Up/ });
  const level = page.getByRole('button', { name: /Level/ });
  const down = page.getByRole('button', { name: /Down/ });
  await expect(up.locator('img')).toBeVisible();
  await expect(level.locator('img')).toBeVisible();
  await expect(down.locator('img')).toBeVisible();
  await expect(up).toHaveAttribute('aria-keyshortcuts', 'U');
  await expect(level).toHaveAttribute('aria-keyshortcuts', 'L');
  await expect(down).toHaveAttribute('aria-keyshortcuts', 'D');

  await page.keyboard.press('l');
  await expect(level).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.path-height-readout')).toHaveText('Build height: 2');
  await page.keyboard.press('d');
  await expect(down).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.tool-status')).toHaveText('Slope: Down.');
  await page.keyboard.press('u');
  await expect(up).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.path-height-readout')).toHaveText('Build height: 2');

  for (let piece = 0; piece < 5; piece++) {
    await expect(ghost).toHaveAttribute('data-z', String(START_LEVEL + piece));
    await page.getByRole('button', { name: 'Build', exact: true }).click();
    await expect(page.locator('.tool-status')).toContainText('Built at');
    await expect(ghost).toHaveAttribute('data-z', String(START_LEVEL + piece + 1));
  }

  await expect.poll(() => hudCashCents(page)).toBe(cashBefore - 5 * 1_000);
  await expect(ghost).toHaveAttribute('data-y', '38');
  await expect(page.locator('.path-height-readout')).toHaveText(`Build height: ${START_LEVEL + 5}`);
});
