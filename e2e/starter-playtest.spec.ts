import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test } from '@playwright/test';

test('plays the starter park shell and exercises save file round trips', async ({
  page,
}, testInfo) => {
  test.setTimeout(900_000);
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`);
    await mkdir(dirname(path), { recursive: true });
    await page.screenshot({ path, fullPage: true });
    await testInfo.attach(name, { path, contentType: 'image/png' });
  };
  const currentTick = async () => {
    const hud = await page.locator('.hud').innerText();
    const tick = hud.match(/\btick (\d+)\b/);
    if (!tick) throw new Error('Simulation tick is missing from the HUD');
    return Number(tick[1]);
  };

  await page.goto('/');
  page.setDefaultTimeout(15_000);
  await expect(page.getByRole('heading', { name: 'OpenCoaster' })).toBeVisible();
  await screenshot('01-title-screen');

  await page.getByRole('button', { name: 'New game' }).click();
  const starterCard = page.locator('.scenario-card').filter({ hasText: 'Starter Park' });
  await expect(starterCard).toBeVisible();
  await starterCard.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('button', { name: '4×' })).toBeVisible();
  await screenshot('02-starter-park');

  await page.getByRole('button', { name: 'Staff' }).click();
  await page.getByRole('button', { name: 'Hire Handyman' }).click();
  await page.getByRole('button', { name: 'Hire Mechanic' }).click();
  await expect(page.locator('[data-panel="staff"] .panel-content')).toContainText(
    'Staff employed  2',
  );
  await screenshot('03-staff-hired');

  await page.getByRole('button', { name: 'Path', exact: true }).click();
  const tickBeforePath = await currentTick();
  await page.locator('#game').click({ position: { x: 700, y: 200 } });
  await expect(page.locator('.tool-status')).toContainText('Path placement requested');
  await expect.poll(currentTick).toBeGreaterThan(tickBeforePath);
  await screenshot('04-path-building');

  await page.getByRole('button', { name: 'Ride', exact: true }).click();
  await page
    .locator('.coaster-panel .coaster-row')
    .filter({ hasText: 'New ride' })
    .locator('select')
    .selectOption('1');
  await page.locator('#game').click({ position: { x: 800, y: 200 } });
  await expect(page.locator('.coaster-feedback')).toContainText('Done.');
  await screenshot('05-flat-ride-built');

  await page.getByRole('button', { name: 'Coaster', exact: true }).click();
  await expect(page.locator('.coaster-panel')).toBeVisible();
  await screenshot('06-coaster-controls');

  await page.getByRole('button', { name: 'Ride', exact: true }).click();
  const newRide = page
    .locator('.coaster-panel .coaster-row')
    .filter({ hasText: 'New ride' })
    .locator('select');
  await newRide.selectOption('10');
  await page.locator('#game').click({ position: { x: 600, y: 200 } });
  await expect(page.locator('.coaster-info')).toContainText('Steel Looping Coaster', {
    timeout: 15_000,
  });
  await page.mouse.move(601, 201);
  await page.mouse.move(600, 200);

  const selectFor = (label: string) =>
    page.locator('.coaster-panel .coaster-row').filter({ hasText: label }).locator('select');
  await expect(selectFor('Drive').locator('option')).not.toHaveCount(0);
  let trackPieces = 0;
  const placePiece = async (shape: string, slope: string, drive = 'Normal') => {
    await selectFor('Shape').selectOption({ label: shape });
    await selectFor('Slope').selectOption({ label: slope });
    await selectFor('Drive').selectOption({ label: drive });
    await page.getByRole('button', { name: 'Place piece' }).click();
    trackPieces++;
    await screenshot(`coaster-piece-${trackPieces}`);
    await expect(page.locator('.coaster-info')).toContainText(`Track ${trackPieces} pieces`);
  };

  await placePiece('Station', 'Level');
  await placePiece('Straight', 'Up', 'Chain lift');
  await placePiece('Straight', 'Up', 'Chain lift');
  await placePiece('Straight', 'Level', 'Chain lift');
  await placePiece('Loop right', 'Level');
  await placePiece('Straight', 'Level');
  await placePiece('Right small', 'Level');
  await placePiece('Right medium', 'Level');
  await placePiece('Straight', 'Down');
  await placePiece('Straight', 'Down');
  await placePiece('Straight', 'Level');
  await placePiece('Right large', 'Level');
  await placePiece('Right small', 'Level');
  await expect(page.locator('.coaster-info')).toContainText(
    `Track ${trackPieces} pieces, closed circuit`,
  );
  await screenshot('07-coaster-built');

  await page.getByRole('button', { name: 'Finances' }).click();
  await expect(page.locator('[data-panel="finance"] .panel-content')).toContainText('Cash');
  await screenshot('08-finances');

  await page.getByRole('button', { name: 'Menu' }).click();
  const menu = page.locator('[aria-label="Game menu"]');
  await expect(menu).toBeVisible();
  await page.getByLabel('Save name').fill('Starter playtest');
  await page.getByRole('button', { name: 'Save to new slot' }).click();
  await expect(menu).toContainText('Game saved.');
  await screenshot('09-saved');

  const exportPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export save file' }).click();
  const download = await exportPromise;
  const savePath = testInfo.outputPath('starter-playtest.ocsave');
  await download.saveAs(savePath);
  await expect(menu).toContainText('Save file downloaded.');
  await screenshot('10-exported');

  await page.getByRole('button', { name: 'Import save file' }).click();
  await page.locator('.save-menu input[type="file"]').setInputFiles(savePath);
  await expect(menu).toBeHidden();
  await expect(page.locator('[data-panel="staff"] .panel-content')).toContainText(
    'Staff employed  2',
  );
  await expect(page.locator('.coaster-info')).toContainText('Track 13 pieces, closed circuit');
  await screenshot('11-imported');

  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(menu.getByRole('button', { name: 'Load' })).toBeVisible();
  await menu.getByRole('button', { name: 'Load' }).click();
  await expect(menu).toBeHidden();
  await expect(page.locator('[data-panel="staff"] .panel-content')).toContainText(
    'Staff employed  2',
  );
  await expect(page.locator('.coaster-info')).toContainText('Track 13 pieces, closed circuit');
  await screenshot('12-loaded');

  if (process.env.E2E_SKIP_YEAR !== '1') {
    await page.getByRole('button', { name: '4×' }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 850_000 });
    await expect(page.locator('.outcome-heading')).toHaveText(/Objective (met|missed)/);
    await screenshot('13-year-one-outcome');
  }
});
