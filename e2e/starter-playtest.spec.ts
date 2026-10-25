import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test } from '@playwright/test';

test('plays the starter park shell and exercises save file round trips', async ({
  page,
}, testInfo) => {
  test.setTimeout(1_200_000);
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`);
    await mkdir(dirname(path), { recursive: true });
    await page.screenshot({ path, fullPage: true, timeout: 60_000 });
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
  await starterCard.getByRole('button', { name: 'Start', exact: true }).click();
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
  await expect(page.locator('.tool-status')).toContainText('Place entrance');
  await page
    .getByRole('button', { name: /Place entrance at tile/ })
    .first()
    .click();
  await expect(page.locator('.tool-status')).toContainText('Place exit');
  await page
    .getByRole('button', { name: /Place exit at tile/ })
    .first()
    .click();
  await expect(page.locator('.tool-status')).toContainText('Ride setup complete');
  await screenshot('05-flat-ride-built');

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
    const rideRow = page
      .locator('[data-panel="ride-list"] .list-row')
      .filter({ hasText: 'Merry-Go-Round' });
    await expect(rideRow).toBeVisible();
    const rideId = await rideRow.getAttribute('data-ride-id');
    if (!rideId) throw new Error('Merry-Go-Round row is missing its ride id');
    await rideRow.click();
    const rideWindow = page.locator(`[data-panel="ride-${rideId}"]`);
    await expect(rideWindow).toBeVisible();
    await expect(rideWindow.locator('.ride-status')).toHaveText('Closed');
    await page.keyboard.press('Shift+Backspace');
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
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1_100_000 });
    await expect(page.locator('.outcome-heading')).toHaveText(/Objective (met|missed)/);
    await screenshot('13-year-one-outcome');
  }
});
