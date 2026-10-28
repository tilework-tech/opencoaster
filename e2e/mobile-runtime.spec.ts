import { devices, expect, test } from './support/test';
import { createTestContext } from './support/test-contexts';

test('the app shell reloads offline after the mobile service worker is installed', async ({
  freshBrowser: browser,
}) => {
  const { defaultBrowserType: _browserType, ...options } = devices['Pixel 8'];
  void _browserType;
  const context = await createTestContext(browser, { ...options, serviceWorkers: 'allow' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.goto('/');

  const manifest = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifest).toBeTruthy();
  const manifestResponse = await page.request.get(new URL(manifest!, page.url()).toString());
  expect(manifestResponse.ok()).toBe(true);
  expect(await manifestResponse.json()).toMatchObject({
    name: 'OpenCoaster',
    display: 'standalone',
  });

  await page.evaluate(async () => navigator.serviceWorker.ready);
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'OpenCoaster' })).toBeVisible();
  await page.getByRole('button', { name: 'Sandbox' }).click();
  await expect(page.locator('.hud')).toContainText(/\btick \d+\b/, { timeout: 20_000 });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'OpenCoaster' })).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'OpenCoaster' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sandbox' })).toBeVisible();
  await page.getByRole('button', { name: 'Sandbox' }).click();
  await expect(page.locator('.hud')).toContainText(/\btick \d+\b/, { timeout: 20_000 });
  const tickText = await page.locator('.hud').innerText();
  const tick = Number(tickText.match(/\btick (\d+)\b/)?.[1]);
  await expect
    .poll(async () => {
      const text = await page.locator('.hud').innerText();
      return Number(text.match(/\btick (\d+)\b/)?.[1]);
    })
    .toBeGreaterThan(tick);
  await context.close();
});
