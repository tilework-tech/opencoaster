import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';

test('runs the park through WebGL2 with 5,000 guests and captures a frame', async ({
  page,
}, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('./');
  await page.getByRole('button', { name: 'Sandbox' }).click();
  const hud = page.locator('.hud');
  await expect(hud).toContainText('WebGL2', { timeout: 20_000 });
  const toolbar = page.locator('.game-toolbar');
  await expect(page.locator('[data-panel="park"]')).toBeVisible();
  await toolbar.getByRole('button', { name: 'Rides', exact: true }).click();
  await expect(page.locator('[data-panel="ride-list"]')).toContainText('None have been built yet.');
  await page.locator('[data-panel="ride-list"] [data-action="close-ride-list"]').click();
  await toolbar.getByRole('button', { name: 'New ride' }).click();
  await page.getByRole('tab', { name: 'Shops & Stalls' }).click();
  await expect(page.getByRole('button', { name: /^Food Stall/ })).toBeVisible();
  await page.locator('[data-panel="ride-select"] [data-action="close-ride-select"]').click();

  const gameCanvasUsesWebGl2 = await page.locator('#game').evaluate((canvas) => {
    return canvas.getContext('webgl2') instanceof WebGL2RenderingContext;
  });
  expect(gameCanvasUsesWebGl2).toBe(true);

  await toolbar.getByRole('button', { name: 'Game options' }).click();
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: 'Guests +1,000' }).click();
  }
  await expect(hud).toContainText(/\bguests 5000\b/, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Save, load and quit…' }).click();
  const menu = page.locator('[aria-label="Game menu"]');
  await expect(menu).toBeVisible();
  const tickBeforeResume = await hud.evaluate((element) => {
    const match = element.textContent?.match(/\btick (\d+)\b/);
    if (!match) throw new Error('Simulation tick is missing from the HUD');
    return Number(match[1]);
  });
  await menu.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(menu).toBeHidden();
  await expect
    .poll(async () => {
      const match = (await hud.innerText()).match(/\btick (\d+)\b/);
      return match ? Number(match[1]) : tickBeforeResume;
    })
    .toBeGreaterThan(tickBeforeResume);
  await expect(hud).toContainText(/\bguests 5000\b/, { timeout: 10_000 });

  const screenshot = testInfo.outputPath('webgl2-smoke.png');
  await mkdir(dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot });

  const canvasScreenshot = testInfo.outputPath('webgl2-canvas.png');
  await page.locator('#game').screenshot({ path: canvasScreenshot });
  const { data: pixels, info } = await sharp(canvasScreenshot)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let clearPixels = 0;
  for (let offset = 0; offset < pixels.length; offset += info.channels) {
    if (pixels[offset] === 15 && pixels[offset + 1] === 20 && pixels[offset + 2] === 26)
      clearPixels++;
  }
  expect(clearPixels / (info.width * info.height)).toBeLessThan(0.1);

  const frameSamples = await page.evaluate(async () => {
    const element = document.querySelector('.hud');
    if (!element) throw new Error('Performance HUD is missing');
    const samples: number[] = [];

    await new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        const match = element.textContent?.match(/frame ([\d.]+)ms/);
        if (match) samples.push(Number(match[1]));
        if (samples.length >= 100) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(element, { childList: true, characterData: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        resolve();
      }, 30_000);
    });

    return samples;
  });
  expect(frameSamples.length).toBeGreaterThanOrEqual(100);
  expect(frameSamples.every((sample) => Number.isFinite(sample) && sample >= 0)).toBe(true);
  const sortedFrames = [...frameSamples].sort((a, b) => a - b);
  const frameAt = (p: number): number => sortedFrames[Math.ceil(p * sortedFrames.length) - 1];
  console.log(
    `WebGL2 frame ms (${frameSamples.length} samples): ` +
      `p50 ${frameAt(0.5).toFixed(2)} p95 ${frameAt(0.95).toFixed(2)} ` +
      `p99 ${frameAt(0.99).toFixed(2)} max ${sortedFrames.at(-1)?.toFixed(2)}`,
  );

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
