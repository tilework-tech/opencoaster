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
  const toolbar = page.locator('.game-toolbar');
  const toolbarButton = (name: string) => toolbar.getByRole('button', { name, exact: true });
  await expect(toolbarButton('Game options')).toBeVisible();
  await expect(page.locator('[data-panel="park"]')).toBeVisible();
  await screenshot('02-starter-park');

  await toolbarButton('Staff').click();
  await page.getByRole('button', { name: 'Hire Handyman' }).click();
  await page.getByRole('tab', { name: 'Mechanics' }).click();
  await page.getByRole('button', { name: 'Hire Mechanic' }).click();
  await expect(page.locator('[data-panel="staff"]')).toContainText('Staff employed  2');
  await screenshot('03-staff-hired');
  await page.keyboard.press('Shift+Backspace');
  await expect(page.locator('.ui-window')).toHaveCount(0);

  await toolbarButton('Footpaths').click();
  const tickBeforePath = await currentTick();
  await page.locator('#game').click({ position: { x: 700, y: 200 } });
  await expect(page.locator('.tool-status')).toContainText('Path placement requested');
  await expect.poll(currentTick).toBeGreaterThan(tickBeforePath);
  await screenshot('04-path-building');

  const buildRide = async (tab: string, ride: string, at: { x: number; y: number }) => {
    if (!(await page.locator('[data-panel="ride-select"]').isVisible()))
      await toolbarButton('New ride').click();
    await page.getByRole('tab', { name: tab }).click();
    await page.getByRole('button', { name: new RegExp(`^${ride}`) }).click();
    await page.locator('#game').click({ position: at });
  };
  await buildRide('Gentle rides', 'Merry-Go-Round', { x: 800, y: 200 });
  await expect(page.locator('.tool-status')).toContainText('Done.');
  await screenshot('05-flat-ride-built');

  await buildRide('Shops & Stalls', 'Food Stall', { x: 760, y: 260 });
  await expect(page.locator('.tool-status')).toContainText('Done.');

  await buildRide('Roller Coasters', 'Steel Looping Coaster', { x: 600, y: 200 });
  await expect(page.locator('.coaster-info')).toContainText('Steel Looping Coaster', {
    timeout: 15_000,
  });
  await expect(page.locator('[data-panel="construction"]')).toBeVisible();
  await screenshot('06-coaster-controls');
  await page.mouse.move(601, 201);
  await page.mouse.move(600, 200);

  const construction = page.locator('[data-panel="construction"]');
  await expect(construction.getByLabel('Drive').locator('option')).not.toHaveCount(0);
  let trackPieces = 0;
  const specials = ['Station', 'Loop right'];
  const placePiece = async (shape: string, slope: string, drive = 'Normal') => {
    if (specials.includes(shape))
      await construction.getByLabel('Special elements').selectOption({ label: shape });
    else await construction.getByRole('button', { name: shape, exact: true }).click();
    await construction.getByRole('button', { name: slope, exact: true }).click();
    await construction.getByLabel('Drive').selectOption({ label: drive });
    await construction.getByRole('button', { name: 'Build piece' }).click();
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

  await toolbarButton('Finances').click();
  await expect(page.locator('[data-panel="finance"]')).toContainText('Cash');
  await screenshot('08-finances');

  await toolbarButton('Park').click();
  await page.getByRole('tab', { name: 'Admission' }).click();
  await page.getByRole('button', { name: 'Pay to enter' }).click();
  const admission = page.getByRole('textbox', { name: 'Park admission' });
  await admission.fill('3.50');
  await admission.press('Enter');
  await admission.blur();
  await expect(admission).toHaveValue('3.50');
  await screenshot('08b-admission');

  const closeButtons = page.locator('.ui-window button[aria-label^="Close"]');
  while (await closeButtons.count()) await closeButtons.first().click();
  await toolbarButton('Game options').click();
  await page.getByRole('button', { name: 'Save, load and quit…' }).click();
  const menu = page.locator('[aria-label="Game menu"]');
  await expect(menu).toBeVisible();
  await page.getByLabel('Save name').fill('Starter playtest');
  await page.getByRole('button', { name: 'Save to new slot' }).click();
  await expect(menu).toContainText('Game saved.');
  await screenshot('09-saved');

  const expectRestoredPark = async () => {
    await toolbarButton('Staff').click();
    await expect(page.locator('[data-panel="staff"]')).toContainText('Staff employed  2');
    await page.getByRole('button', { name: 'Close Staff' }).click();
    await toolbarButton('Rides').click();
    await expect(page.locator('[data-panel="ride-list"]')).toContainText(
      'Steel Looping Coaster',
    );
    await page.getByRole('button', { name: 'Close Rides and attractions' }).click();
  };

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
  await expectRestoredPark();
  await screenshot('11-imported');

  await toolbarButton('Game options').click();
  await page.getByRole('button', { name: 'Save, load and quit…' }).click();
  await expect(menu.getByRole('button', { name: 'Load' })).toBeVisible();
  await menu.getByRole('button', { name: 'Load' }).click();
  await expect(menu).toBeHidden();
  await expectRestoredPark();
  await screenshot('12-loaded');

  if (process.env.E2E_RUN_YEAR === '1') {
    await toolbarButton('Game options').click();
    await page.getByRole('button', { name: '4×' }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 850_000 });
    await expect(page.locator('.outcome-heading')).toHaveText(/Objective (met|missed)/);
    await screenshot('13-year-one-outcome');
  }
});
