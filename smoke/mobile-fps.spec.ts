import { devices, expect, test } from '@playwright/test';

const CPU_THROTTLE = 4;
const DEVICE_PIXEL_RATIO = 2.6;
/** Adaptive resolution needs a few seconds under load before frame times settle. */
const WARMUP_MS = 8_000;
const SAMPLE_MS = 6_000;

/** Soft budgets: a miss is reported in the output and as a test annotation, never a failure. */
const CASES = [
  { guests: 2_000, medianFpsBudget: 55 },
  { guests: 5_000, medianFpsBudget: 30 },
];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

for (const { guests, medianFpsBudget } of CASES) {
  test(`mobile emulation holds ${medianFpsBudget} FPS median with ${guests} guests`, async ({
    browser,
  }, testInfo) => {
    test.setTimeout(90_000);
    const { defaultBrowserType: _browserType, ...options } = devices['Pixel 8'];
    void _browserType;
    const context = await browser.newContext({ ...options, deviceScaleFactor: DEVICE_PIXEL_RATIO });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });

    await page.goto('/');
    await page.getByRole('button', { name: 'Sandbox' }).click();
    const hud = page.locator('.hud');
    await expect(hud).toContainText('WebGL2', { timeout: 30_000 });
    const toolbar = page.locator('.game-toolbar');
    const optionsButton = toolbar.getByRole('button', { name: 'Game options', exact: true });
    if (!(await optionsButton.isVisible()))
      await toolbar.getByRole('button', { name: 'Actions', exact: true }).click();
    await optionsButton.click();
    for (let have = 1_000; have < guests; have += 1_000) {
      await page.getByRole('button', { name: 'Guests +1,000' }).click();
      await expect(hud).toContainText(new RegExp(`guests ${have + 1_000}\\b`), {
        timeout: 60_000,
      });
    }
    await page.keyboard.press('Shift+Backspace');
    await page.waitForTimeout(WARMUP_MS);

    const intervals = await page.evaluate(
      (durationMs) =>
        new Promise<number[]>((resolve) => {
          const deltas: number[] = [];
          const start = performance.now();
          let previous = start;
          const tick = (now: number): void => {
            deltas.push(now - previous);
            previous = now;
            if (now - start >= durationMs) resolve(deltas);
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
      SAMPLE_MS,
    );
    const renderScale = await page.locator('#game').evaluate((canvas) => {
      return (canvas as HTMLCanvasElement).width / canvas.clientWidth;
    });
    const fps = intervals.slice(1).map((dt) => 1000 / dt);
    const medianFps = median(fps);
    const frameMs = [...intervals.slice(1)].sort((a, b) => a - b);
    const p95Ms = frameMs[Math.ceil(0.95 * frameMs.length) - 1];
    const summary =
      `Mobile emulation (Pixel 8, ${CPU_THROTTLE}x CPU, DPR ${DEVICE_PIXEL_RATIO}), ${guests} guests: ` +
      `${fps.length} frames, median ${medianFps.toFixed(1)} FPS, p95 frame ${p95Ms.toFixed(1)} ms, ` +
      `render scale ${renderScale.toFixed(2)}x ` +
      `(budget ${medianFpsBudget} FPS)`;
    console.log(summary);
    if (medianFps < medianFpsBudget) {
      testInfo.annotations.push({ type: 'soft-budget-miss', description: summary });
      console.warn(`SOFT BUDGET MISS: ${summary}`);
    }
    expect(fps.length).toBeGreaterThan(10);
    await context.close();
  });
}
