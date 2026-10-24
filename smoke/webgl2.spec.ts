import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test } from '@playwright/test';

test('runs the park through WebGL2 with 5,000 guests and captures a frame', async ({
  page,
}, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await page.getByRole('button', { name: 'Sandbox' }).click();
  const hud = page.locator('.hud');
  await expect(hud).toContainText('WebGL2', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Rides' }).click();
  await expect(page.locator('[data-panel="rides"]')).toContainText('No rides have been built yet.');
  await expect(page.getByRole('button', { name: 'Place entrance' })).toBeVisible();

  const gameCanvasUsesWebGl2 = await page.locator('#game').evaluate((canvas) => {
    return canvas.getContext('webgl2') instanceof WebGL2RenderingContext;
  });
  expect(gameCanvasUsesWebGl2).toBe(true);

  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: 'Guests +1,000' }).click();
  }
  await expect(hud).toContainText(/\bguests 5000\b/, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.keyboard.press('g');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.waitForTimeout(500);
  await expect(hud).toContainText(/\bguests 5000\b/, { timeout: 10_000 });

  const frameSamples = await page.evaluate(async () => {
    const element = document.querySelector('.hud');
    if (!element) throw new Error('Performance HUD is missing');
    const samples: number[] = [];

    await new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        const match = element.textContent?.match(/frame ([\d.]+)ms/);
        if (match) samples.push(Number(match[1]));
        if (samples.length >= 200) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(element, { childList: true, characterData: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        resolve();
      }, 10_000);
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

  const screenshot = testInfo.outputPath('webgl2-smoke.png');
  await mkdir(dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot });

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
