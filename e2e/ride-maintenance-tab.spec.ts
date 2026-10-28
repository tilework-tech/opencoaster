import { writeFile } from 'node:fs/promises';
import { expect, test } from './support/test';
import { serialize } from '../src/save/save';
import { createRide } from '../src/sim/rides/ride-operations';
import { RideType } from '../src/sim/rides/ride-types';
import { createStarterWorld, startStarterPark } from './footpath-helpers';

test('the ride window Maintenance tab shows reliability, downtime and inspection details', async ({
  page,
}, testInfo) => {
  const world = createStarterWorld();
  expect(createRide(world, RideType.MerryGoRound, 23, 43)).toBeGreaterThanOrEqual(0);
  const savePath = testInfo.outputPath('maintenance-ride.park');
  await writeFile(savePath, serialize(world));

  await startStarterPark(page);
  await page
    .locator('.game-toolbar')
    .getByRole('button', { name: 'Save / Load', exact: true })
    .click();
  await page.getByRole('button', { name: 'Import save file' }).click();
  await page.locator('.save-menu input[type="file"]').setInputFiles(savePath);
  await expect(page.locator('.hud')).toContainText('tick');

  await page.locator('.game-toolbar').getByRole('button', { name: 'Rides', exact: true }).click();
  await page
    .locator('[data-panel="ride-list"] .list-row')
    .filter({ hasText: 'Merry-Go-Round' })
    .click();

  const win = page.locator('[data-panel="ride-0"]');
  await win.getByRole('tab', { name: 'Maintenance', exact: true }).click();

  await expect(win).toContainText('Reliability');
  await expect(win).toContainText('Downtime');
  await expect(win).toContainText('Last inspection');
  await expect(win).toContainText('Mechanic');

  const interval = win.getByLabel('Inspection interval');
  await interval.selectOption({ label: '20 minutes' });
  await expect(interval).toHaveValue('20');
  await interval.selectOption({ label: 'Never' });
  // Past the window in which the chosen value is held on screen, the simulation's value shows.
  await page.waitForTimeout(2_500);
  await expect(interval).toHaveValue('0');
});
