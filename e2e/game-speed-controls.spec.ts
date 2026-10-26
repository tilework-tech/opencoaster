import { devices, expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const pixel8 = devices['Pixel 8'];

/** Ticks the sim advanced per wall-clock second, read from the status bar date chip. */
async function ticksPerSecond(page: Page, windowMs = 3_000): Promise<number> {
  return page.evaluate(
    (windowMs) =>
      new Promise<number>((resolve) => {
        const chip = document.querySelector<HTMLElement>('.status-date');
        const startTick = Number(chip?.dataset.tick);
        const startedAt = performance.now();
        setTimeout(() => {
          const ticks = Number(chip?.dataset.tick) - startTick;
          resolve(ticks / ((performance.now() - startedAt) / 1000));
        }, windowMs);
      }),
    windowMs,
  );
}

async function startSandbox(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sandbox', exact: true }).click();
  await expect(page.locator('.status-date')).toHaveAttribute('data-tick', /^\d+$/);
}

test.describe('desktop speed controls', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('toolbar speed buttons change the simulation rate', async ({ page }) => {
    await startSandbox(page);
    const toolbar = page.locator('.game-toolbar');
    const speed = (value: number) => toolbar.getByRole('button', { name: `Game speed ${value}×` });

    await expect(speed(1)).toHaveAttribute('aria-pressed', 'true');
    const normal = await ticksPerSecond(page);

    await speed(4).click();
    await expect(speed(4)).toHaveAttribute('aria-pressed', 'true');
    await expect(speed(1)).toHaveAttribute('aria-pressed', 'false');
    const fast = await ticksPerSecond(page);
    expect(fast, `4× ${fast} vs 1× ${normal} ticks/s`).toBeGreaterThan(normal * 2.5);

    await page.keyboard.press('2');
    await expect(speed(2)).toHaveAttribute('aria-pressed', 'true');
    const twice = await ticksPerSecond(page);
    expect(twice, `2× ${twice} vs 1× ${normal} ticks/s`).toBeGreaterThan(normal * 1.5);
  });

  test('Options Game tab shows and sets the same speed as the toolbar', async ({ page }) => {
    await startSandbox(page);
    await page.getByRole('button', { name: 'Game options' }).click();
    const option = page.getByRole('button', { name: '4× (2× while building)', exact: true });
    await option.click();

    await expect(
      page.locator('.game-toolbar').getByRole('button', { name: 'Game speed 4×' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(option).toHaveAttribute('aria-pressed', 'true');
  });

  test('+ and - step through the speeds', async ({ page }) => {
    await startSandbox(page);
    const speed = (value: number) =>
      page.locator('.game-toolbar').getByRole('button', { name: `Game speed ${value}×` });
    await page.keyboard.press('+');
    await expect(speed(2)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('+');
    await expect(speed(4)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('-');
    await expect(speed(2)).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('phone speed controls', () => {
  test.use({
    viewport: pixel8.viewport,
    deviceScaleFactor: pixel8.deviceScaleFactor,
    userAgent: pixel8.userAgent,
    isMobile: true,
    hasTouch: true,
  });

  test('Actions menu speed buttons change the simulation rate', async ({ page }) => {
    await startSandbox(page);
    const toolbar = page.locator('.game-toolbar');
    await toolbar.getByRole('button', { name: 'Actions', exact: true }).tap();
    const speed = (value: number) => toolbar.getByRole('button', { name: `Game speed ${value}×` });

    await expect(speed(4)).toBeVisible();
    for (const value of [1, 4]) {
      const size = await speed(value).evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      expect(size.width, `${value}× width`).toBeGreaterThanOrEqual(44);
      expect(size.height, `${value}× height`).toBeGreaterThanOrEqual(44);
    }

    const normal = await ticksPerSecond(page);
    await speed(4).tap();
    await expect(speed(4)).toHaveAttribute('aria-pressed', 'true');
    const fast = await ticksPerSecond(page);
    expect(fast, `4× ${fast} vs 1× ${normal} ticks/s`).toBeGreaterThan(normal * 2.5);
  });
});
