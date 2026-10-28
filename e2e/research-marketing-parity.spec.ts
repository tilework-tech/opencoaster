import { expect, test } from './support/test';
import type { Page } from './support/test';
import { startStarterPark, toolbarAction } from './support/footprints';

test.use({ launchOptions: { args: ['--disable-webgl'] } });

async function waitForSprites(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const { spritePages } = await import('../src/render/sprite-pages.ts');
    spritePages.start();
    while (spritePages.pageInfos.length === 0)
      await new Promise((resolve) => setTimeout(resolve, 25));
    const categories = ['world', 'people', 'flat-rides'];
    categories.forEach((category) => spritePages.requestCategory(category));
    const deadline = Date.now() + 120_000;
    while (categories.some((category) => !spritePages.isLoaded(category))) {
      if (Date.now() > deadline) throw new Error('sprite categories did not finish loading');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  });
}

test('research and marketing windows expose RCT2 research and campaign details', async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  await startStarterPark(page);
  await waitForSprites(page);

  await toolbarAction(page, 'Research');
  await page.getByRole('tab', { name: 'Funding' }).click();
  await page.getByRole('button', { name: /Maximum.*400.*month/i }).click();
  const rollerCoasters = page.getByLabel('Roller Coasters');
  await rollerCoasters.check();
  await expect(rollerCoasters).toBeChecked();
  for (const category of [
    'Transport Rides',
    'Gentle Rides',
    'Roller Coasters',
    'Thrill Rides',
    'Water Rides',
    'Shops & Stalls',
    'Scenery & Themeing',
  ]) {
    await expect(page.getByText(category, { exact: true })).toBeVisible();
  }
  await page.screenshot({
    path: testInfo.outputPath('research-funding-window.png'),
    fullPage: true,
  });
  await page.getByRole('tab', { name: 'Development' }).click();
  await expect(page.getByText(/Wooden Coaster — Initial research/)).toBeVisible();
  await page.getByRole('tab', { name: 'Funding' }).click();
  await rollerCoasters.uncheck();
  await page.getByRole('tab', { name: 'Development' }).click();
  await expect(page.getByText('No research selected', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Funding' }).click();
  await rollerCoasters.check();
  await page.getByRole('tab', { name: 'Development' }).click();
  await expect(page.getByText(/Wooden Coaster — Initial research/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('research-window.png'), fullPage: true });

  await page.getByRole('button', { name: 'Close Research and development' }).click();
  await toolbarAction(page, 'Finances');
  await page.getByRole('tab', { name: 'Marketing' }).click();
  const campaigns = [
    ['Free park-entry vouchers', '$50.00/wk'],
    ['Park advertising', '$350.00/wk'],
    ['Free ride vouchers', '$50.00/wk'],
    ['Half-price park-entry vouchers', '$50.00/wk'],
    ['Free food or drink vouchers', '$50.00/wk'],
    ['Selected-ride advertising', '$200.00/wk'],
  ];
  for (const [id, [name, price]] of campaigns.entries()) {
    await expect(page.locator(`[data-campaign="${id}"]`)).toContainText(name);
    await expect(page.locator(`[data-campaign="${id}"]`)).toContainText(price);
  }
  const length = page.getByLabel('Length');
  await expect(length.locator('option')).toHaveCount(6);
  await expect(length.locator('option').nth(0)).toHaveText('1 week');
  await expect(length.locator('option').nth(5)).toHaveText('6 weeks');
  await page.screenshot({ path: testInfo.outputPath('marketing-window.png'), fullPage: true });
});
