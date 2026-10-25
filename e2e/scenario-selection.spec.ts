import { expect, test } from '@playwright/test';

const TABS = ['Beginner Parks', 'Challenging Parks', 'Expert Parks', 'Real Parks', 'Other Parks'];

test('scenario selection lists every tab and remembers completed parks', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();

  for (const tab of TABS) {
    await page.getByRole('tab', { name: tab }).click();
    await expect(page.locator('.scenario-card').first()).toBeVisible();
    await expect(page.locator('.scenario-objective')).toContainText('Objective');
  }
  await expect(page.getByRole('tab', { name: 'Beginner Parks' })).toContainText('(0/');

  await page.evaluate(() => {
    localStorage.setItem(
      'opencoaster.scenarioProgress.v1',
      JSON.stringify({ meadowbrook: { completedAt: 1_700_000_000_000 } }),
    );
  });
  await page.reload();
  await page.getByRole('button', { name: 'New game' }).click();
  await expect(page.getByRole('tab', { name: 'Beginner Parks' })).toContainText('(1/');
  const card = page.locator('.scenario-card').filter({ hasText: 'Meadowbrook Green' });
  await expect(card).toHaveClass(/completed/);
  await expect(card).toContainText('Completed');
  await card.getByRole('button', { name: 'Meadowbrook Green' }).click();
  await expect(page.locator('.scenario-preview-panel .scenario-status')).toContainText('Completed');

  await card.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.title-screen')).toBeHidden();
});
