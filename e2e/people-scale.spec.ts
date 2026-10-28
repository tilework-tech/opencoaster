import { expect, test, devices } from './support/test';
import { createTestContext } from './support/test-contexts';
import type { Page } from './support/test';
import sharp from 'sharp';

async function startSandbox(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sandbox' }).click();
  await expect(page.locator('.hud')).toContainText('guests 1000');
  await expect(page.locator('.hud')).toContainText('WebGL2');
}

async function toolbarAction(page: Page, name: string, mobile: boolean): Promise<void> {
  const toolbar = page.locator('.game-toolbar');
  if (mobile) {
    await toolbar.getByRole('button', { name: 'Actions', exact: true }).tap();
    await toolbar.getByRole('button', { name, exact: true }).tap();
  } else await toolbar.getByRole('button', { name, exact: true }).click();
}

async function visibleColorPixels(page: Page): Promise<number> {
  const viewportWidth = await page.evaluate(() => innerWidth);
  const image = await page.locator('canvas').first().screenshot();
  const { data, info } = await sharp(image)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let pixels = 0;
  for (let offset = 0; offset < data.length; offset += 3) {
    const red = data[offset]!;
    const green = data[offset + 1]!;
    const blue = data[offset + 2]!;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    if (max - min > max * 0.24 && max > 72 && !(green > red * 1.08 && green > blue * 1.08))
      pixels++;
  }
  return pixels / (info.width / viewportWidth) ** 2;
}

for (const profile of ['desktop', 'pixel-8'] as const) {
  const mobile = profile === 'pixel-8';
  test(`people render in the ${profile} park view`, async ({ freshBrowser: browser }, testInfo) => {
    test.setTimeout(120_000);
    const { defaultBrowserType: _browserType, ...options } = mobile ? devices['Pixel 8'] : {};
    void _browserType;
    const context = await createTestContext(browser, { ...options, serviceWorkers: 'allow' });
    const page = await context.newPage();
    page.setDefaultTimeout(8_000);
    await startSandbox(page);
    await toolbarAction(page, 'Pause', mobile);
    const canvas = page.locator('canvas').first();
    const screenshot = await canvas.screenshot();
    await testInfo.attach(`${profile}-people-in-park.png`, {
      body: screenshot,
      contentType: 'image/png',
    });
    const colorPixels = await visibleColorPixels(page);
    await context.close();
    expect(colorPixels, 'the park canvas contains visible color detail').toBeGreaterThan(100);
  });

  test(`staff roles can be hired in the ${profile} park view`, async ({ freshBrowser: browser }, testInfo) => {
    test.setTimeout(120_000);
    const { defaultBrowserType: _browserType, ...options } = mobile ? devices['Pixel 8'] : {};
    void _browserType;
    const context = await createTestContext(browser, { ...options, serviceWorkers: 'allow' });
    const page = await context.newPage();
    page.setDefaultTimeout(8_000);
    await startSandbox(page);
    await toolbarAction(page, 'Staff', mobile);
    const staff = page.locator('[data-panel="staff"]');
    for (const [tab, role] of [
      ['Handymen', 'Handyman'],
      ['Mechanics', 'Mechanic'],
      ['Security guards', 'Security'],
      ['Entertainers', 'Entertainer'],
    ]) {
      await page.getByRole('tab', { name: tab }).click();
      await staff.getByRole('button', { name: `Hire ${role}` }).click();
    }
    await expect(staff).toContainText('Staff employed  4');
    await page.getByRole('button', { name: 'Close Staff' }).click();
    await toolbarAction(page, 'Pause', mobile);
    const screenshot = await page.locator('canvas').first().screenshot();
    await testInfo.attach(`${profile}-staff-in-park.png`, {
      body: screenshot,
      contentType: 'image/png',
    });
    await context.close();
  });
}
