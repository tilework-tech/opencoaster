import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { devices, expect, test } from '@playwright/test';
import type { Browser, Page, TestInfo } from '@playwright/test';
import sharp from 'sharp';

const MAP_CENTER: readonly [number, number] = [28, 43];

interface Shot {
  data: Buffer;
  width: number;
  height: number;
}

async function capture(page: Page, testInfo: TestInfo, name: string): Promise<Shot> {
  const path = testInfo.outputPath(`${name}.png`);
  await mkdir(dirname(path), { recursive: true });
  const bytes = await page.screenshot({ path, timeout: 30_000 });
  await testInfo.attach(name, { path, contentType: 'image/png' });
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function changed(a: Shot, b: Shot, x: number, y: number): boolean {
  const i = (y * a.width + x) * 4;
  return (
    Math.abs(a.data[i] - b.data[i]) +
      Math.abs(a.data[i + 1] - b.data[i + 1]) +
      Math.abs(a.data[i + 2] - b.data[i + 2]) >
    24
  );
}

async function openPage(browser: Browser, mobile: boolean): Promise<Page> {
  const { defaultBrowserType: _browserType, ...options } = mobile ? devices['Pixel 8'] : {};
  void _browserType;
  const context = await browser.newContext({ ...options, serviceWorkers: 'allow' });
  return context.newPage();
}

async function startStarterPark(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  await page
    .locator('.scenario-card')
    .filter({ hasText: 'Starter Park' })
    .getByRole('button', { name: 'Start', exact: true })
    .click();
  await expect(page.locator('.hud')).toContainText('tick');
}

async function toolbarAction(page: Page, name: string, mobile: boolean): Promise<void> {
  const toolbar = page.locator('.game-toolbar');
  if (mobile) {
    await toolbar.getByRole('button', { name: 'Actions', exact: true }).tap();
    await toolbar.getByRole('button', { name, exact: true }).tap();
  } else await toolbar.getByRole('button', { name, exact: true }).click();
}

async function centerMapOnTile(page: Page, x: number, y: number, mobile: boolean): Promise<void> {
  await toolbarAction(page, 'Map', mobile);
  const minimap = page.locator('.minimap');
  await expect.poll(() => minimap.evaluate((canvas) => canvas.width)).toBe(128);
  const bounds = await minimap.boundingBox();
  if (!bounds) throw new Error('Park map is missing');
  const size = await minimap.evaluate((canvas) => ({ width: canvas.width, height: canvas.height }));
  const mapHeight = size.height - 1;
  await minimap.click({
    position: {
      x: ((x - y + mapHeight + 0.5) / size.width) * bounds.width,
      y: (((x + y) / 2 + 0.25) / size.height) * bounds.height,
    },
  });
  await page.getByRole('button', { name: 'Close Map' }).click();
}

async function clickTile(page: Page, x: number, y: number, mobile: boolean): Promise<void> {
  await centerMapOnTile(page, ...MAP_CENTER, mobile);
  const bounds = await page.locator('#game').boundingBox();
  if (!bounds) throw new Error('Game viewport is missing');
  const dx = x - 1 - MAP_CENTER[0];
  const dy = y - MAP_CENTER[1];
  await page.mouse.click(
    bounds.x + bounds.width / 2 + (dx - dy) * 32,
    bounds.y + bounds.height / 2 + (dx + dy) * 16 - 32,
  );
  await expect(page.locator('.tool-status')).toContainText(new RegExp(`${x}, ${y}`));
}

for (const profile of ['desktop', 'pixel-8'] as const) {
  const mobile = profile === 'pixel-8';
  test.describe(`art scale on ${profile}`, () => {
    for (const ride of [
      { name: 'Swinging Ship', tab: 'Thrill rides', type: 2, minArea: 1900 },
      { name: 'Top Spin', tab: 'Thrill rides', type: 13, minArea: 2300 },
    ]) {
      test(`${ride.name} covers its tile footprint`, async ({ browser }, testInfo) => {
        test.setTimeout(120_000);
        const page = await openPage(browser, mobile);
        page.setDefaultTimeout(8_000);
        await startStarterPark(page);
        const viewport = (await page.locator('#game').boundingBox())!;
        await toolbarAction(page, 'Pause', mobile);
        await centerMapOnTile(page, ...MAP_CENTER, mobile);
        const before = await capture(page, testInfo, `${profile}-${ride.type}-before`);

        await toolbarAction(page, 'Resume', mobile);
        await toolbarAction(page, 'New ride', mobile);
        await page.getByRole('tab', { name: ride.tab }).click();
        await page.locator(`.ride-card[data-ride-type="${ride.type}"]`).click();
        await clickTile(page, 27, 42, mobile);
        const candidates = page.getByRole('button', { name: /Place entrance at tile/ });
        await expect(candidates).toHaveCount(4);
        await toolbarAction(page, 'Pause', mobile);
        const boxes = await candidates.evaluateAll((nodes) =>
          nodes.map((node) => {
            const r = node.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width };
          }),
        );
        const cx = boxes.reduce((sum, b) => sum + b.x, 0) / boxes.length;
        const cy = boxes.reduce((sum, b) => sum + b.y, 0) / boxes.length;
        await page.addStyleTag({
          content:
            '.ride-placement-preview, .ride-placement-targets { visibility: hidden !important; }',
        });
        const after = await capture(page, testInfo, `${profile}-${ride.type}-after`);
        await page.context().close();

        const scale = after.width / viewport.width;
        let area = 0;
        for (let y = Math.round((cy - 70) * scale); y < Math.round((cy + 20) * scale); y++)
          for (let x = Math.round((cx - 40) * scale); x < Math.round((cx + 40) * scale); x++)
            if (changed(before, after, x, y)) area++;
        const cssArea = area / (scale * scale);
        expect(cssArea, `${ride.name} on-screen area in CSS px²`).toBeGreaterThan(ride.minArea);
      });
    }
  });
}
