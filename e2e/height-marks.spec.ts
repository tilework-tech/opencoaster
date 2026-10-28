import { expect, test, type Page } from './support/test';
import { openPage, startScenario } from './support/park';

async function setDisplayOption(page: Page, name: string, on: boolean): Promise<void> {
  const options = page.getByRole('button', { name: 'Game options' });
  await options.focus();
  await options.press('Enter');
  await page.getByRole('tab', { name: 'Display' }).click();
  const box = page.getByRole('checkbox', { name, exact: true });
  await expect(box).toBeEnabled();
  if (on) await box.check();
  else await box.uncheck();
  await options.focus();
  await options.press('Enter');
}

async function inkedPixels(page: Page): Promise<number> {
  return page.locator('.terrain-aids').evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let inked = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) inked++;
    return inked;
  });
}

test('height marks are off by default, toggle from Options > Display, and persist', async ({
  browser,
}) => {
  const page = await openPage(browser, false);
  await page.setViewportSize({ width: 1280, height: 800 });
  await startScenario(page, 'Meadowbrook Green');
  await expect(page.locator('.terrain-aids')).toBeHidden();

  await setDisplayOption(page, 'Height labels', true);
  await expect(page.locator('.terrain-aids')).toBeVisible();
  await expect.poll(() => inkedPixels(page)).toBeGreaterThan(500);

  expect(await page.evaluate(() => localStorage.getItem('opencoaster-option-height-labels'))).toBe(
    'true',
  );

  await setDisplayOption(page, 'Height labels', false);
  await expect(page.locator('.terrain-aids')).toBeHidden();
});

test('hovering a tile reads out its height', async ({ freshBrowser: browser }) => {
  const page = await openPage(browser, false);
  await page.setViewportSize({ width: 1280, height: 800 });
  await startScenario(page, 'Meadowbrook Green');
  await page.mouse.move(640, 400);
  await expect(page.locator('.height-readout')).toBeVisible();
  await expect(page.locator('.height-readout')).toHaveText(/^Height \d+/);
});

test('the construction marker option is available and persists', async ({ freshBrowser: browser }) => {
  const page = await openPage(browser, false);
  await page.setViewportSize({ width: 1280, height: 800 });
  await startScenario(page, 'Meadowbrook Green');
  await setDisplayOption(page, 'Construction marker', true);
  expect(
    await page.evaluate(() => localStorage.getItem('opencoaster-option-construction-marker')),
  ).toBe('true');
});
