import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function measureRendererFrames(
  page: Page,
  count: number,
): Promise<{ frameIntervals: number[]; rendererTimes: number[] }> {
  return page.evaluate(
    (samples) =>
      new Promise<{ frameIntervals: number[]; rendererTimes: number[] }>((resolve) => {
        const frameIntervals: number[] = [];
        const rendererTimes: number[] = [];
        let previous: number | null = null;
        const next = (now: number): void => {
          if (previous !== null) {
            frameIntervals.push(now - previous);
            const frameMs = (window as unknown as { __viewportRenderStats?: { frameMs: number } })
              .__viewportRenderStats?.frameMs;
            if (frameMs !== undefined) rendererTimes.push(frameMs);
          }
          previous = now;
          if (frameIntervals.length >= samples) resolve({ frameIntervals, rendererTimes });
          else requestAnimationFrame(next);
        };
        requestAnimationFrame(next);
      }),
    count,
  );
}

test('guest view follows its target and two pinned viewports coexist', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sandbox' }).click();
  await expect(page.locator('#game')).toBeVisible();

  await page.waitForFunction(() => {
    const snapshot = (window as unknown as { __snapshot?: { guests?: { count: number } } })
      .__snapshot;
    return snapshot !== undefined;
  });
  const guests = await page.evaluate(
    () =>
      (window as unknown as { __snapshot?: { guests?: { count: number } } }).__snapshot?.guests
        ?.count ?? 0,
  );
  if (guests < 1000) {
    await page.getByRole('button', { name: 'Game options' }).click();
    await page.getByRole('button', { name: 'Guests +1,000' }).click();
  }
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __snapshot?: { guests?: { count: number } } }).__snapshot?.guests
            ?.count ?? 0,
      ),
    )
    .toBeGreaterThanOrEqual(1000);
  const baseline = await measureRendererFrames(page, 60);
  await page
    .getByRole('navigation', { name: 'Park controls' })
    .getByRole('button', { name: 'Guests' })
    .click();
  await page
    .getByRole('button', { name: /^Guest \d+ ·/ })
    .first()
    .click();

  const guestView = page.getByRole('img', { name: /Guest \d+ live view/ });
  await expect(guestView).toBeVisible();
  const locate = page.getByRole('button', { name: 'Locate' }).first();
  await page.evaluate(() => {
    const camera = (window as unknown as { __camera?: { x: number } }).__camera;
    if (camera) camera.x += 1000;
  });
  const beforeLocate = await page.evaluate(
    () => (window as unknown as { __camera?: { x: number } }).__camera?.x,
  );
  await locate.click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __camera?: { x: number } }).__camera?.x),
    )
    .not.toBe(beforeLocate);

  await page.getByRole('button', { name: 'View options', exact: true }).click();
  await page.getByRole('button', { name: 'New viewport' }).click();
  await page.getByRole('button', { name: 'View options', exact: true }).click();
  await page.getByRole('button', { name: 'View options', exact: true }).click();
  await page.getByRole('button', { name: 'New viewport' }).click();

  const viewports = page.getByRole('group', { name: 'Viewport' });
  await expect(viewports).toHaveCount(2);
  await page.evaluate(() => {
    const place = (element: Element | null, x: number): void => {
      if (!(element instanceof HTMLElement)) return;
      element.style.setProperty('--x', `${x}px`);
      element.style.setProperty('--y', '80px');
    };
    place(document.querySelector('[data-panel^="guest-"]'), 16);
    place(document.querySelector('[data-panel="viewport-1"]'), 380);
    place(document.querySelector('[data-panel="viewport-2"]'), 744);
  });
  for (const viewport of await viewports.all()) {
    await expect(viewport.getByRole('combobox', { name: 'Follow target' })).toHaveValue(
      /^guest:\d+$/,
    );
  }
  const targetSelect = viewports.first().getByRole('combobox', { name: 'Follow target' });
  const targetSearch = viewports.first().getByRole('searchbox', { name: 'Find target' });
  const initialTarget = await targetSelect.inputValue();
  await targetSearch.fill('Guest');
  await expect.poll(() => targetSelect.locator('option').count()).toBeGreaterThan(1);
  const nextTarget = await targetSelect.locator('option').nth(1).getAttribute('value');
  expect(nextTarget).toBeTruthy();
  expect(nextTarget).not.toBe(initialTarget);
  await targetSelect.selectOption(nextTarget!);
  await expect(targetSelect).toHaveValue(nextTarget!);
  await expect(targetSearch).toHaveValue('');
  await targetSearch.fill('Guest');
  await expect(targetSelect).toHaveValue(nextTarget!);
  await targetSearch.fill('');
  const secondViewport = viewports.nth(1);
  await secondViewport.getByRole('button', { name: 'Pin Viewport' }).click();
  await expect(secondViewport).toHaveClass(/pinned/);
  await viewports.nth(0).getByRole('button', { name: 'Pin Viewport' }).click();
  await expect(viewports.nth(0)).toHaveClass(/pinned/);
  await expect(page.locator('[data-live-viewport]')).toHaveCount(3);
  await page.getByRole('button', { name: 'View options', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Park controls' })
    .getByRole('button', { name: 'Guests' })
    .click();
  await page.screenshot({ path: testInfo.outputPath('guest-two-pinned-viewports.png') });

  await page.getByRole('button', { name: 'View options', exact: true }).click();
  await page.getByRole('button', { name: 'New viewport' }).click();
  await expect(page.locator('[data-live-viewport]')).toHaveCount(4);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __viewportRenderStats?: { count: number } }).__viewportRenderStats
            ?.count,
      ),
    )
    .toBe(4);
  const fourViewports = await measureRendererFrames(page, 60);
  expect(baseline.rendererTimes).toHaveLength(60);
  expect(fourViewports.rendererTimes).toHaveLength(60);
  const mean = (values: number[]): number =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  const frameOverhead = mean(fourViewports.frameIntervals) / mean(baseline.frameIntervals) - 1;
  const rendererOverhead = mean(fourViewports.rendererTimes) / mean(baseline.rendererTimes) - 1;
  console.log(
    `Four-view RAF cost: ${(frameOverhead * 100).toFixed(1)}%; renderer work: ${(rendererOverhead * 100).toFixed(1)}% over baseline`,
  );
  expect(rendererOverhead).toBeLessThanOrEqual(0.15);
});

test('overlapping windows stack opaquely with the focused window on top', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sandbox' }).click();
  await expect(page.locator('#game')).toBeVisible();
  await page.waitForFunction(
    () => (window as unknown as { __snapshot?: unknown }).__snapshot !== undefined,
  );
  await page.getByRole('button', { name: 'Game options' }).click();
  await page.getByRole('button', { name: 'Guests +1,000' }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __snapshot?: { guests?: { count: number } } }).__snapshot?.guests
            ?.count ?? 0,
      ),
    )
    .toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Close Options' }).click();
  const controls = page.getByRole('navigation', { name: 'Park controls' });
  await controls.getByRole('button', { name: 'Park', exact: true }).click();
  await controls.getByRole('button', { name: 'Guests' }).click();
  await page
    .getByRole('button', { name: /^Guest \d+ ·/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'View options', exact: true }).click();
  await page.getByRole('button', { name: 'New viewport' }).click();
  await page.getByRole('button', { name: 'View options', exact: true }).click();
  await page.getByRole('button', { name: 'View options', exact: true }).click();
  await page.getByRole('button', { name: 'New viewport' }).click();
  await expect(page.locator('[data-live-viewport]')).toHaveCount(3);

  await page.evaluate(() => {
    const panels = [...document.querySelectorAll<HTMLElement>('.ui-window')];
    panels.forEach((panel, index) => {
      panel.style.setProperty('--x', `${200 + index * 60}px`);
      panel.style.setProperty('--y', `${100 + index * 40}px`);
    });
  });
  await expect(page.locator('.ui-window')).not.toHaveCount(0);

  const stackingProblems = (): Promise<string[]> =>
    page.evaluate(() => {
      const windows = [...document.querySelectorAll<HTMLElement>('.ui-window')].sort(
        (a, b) => Number(b.style.zIndex) - Number(a.style.zIndex),
      );
      const problems: string[] = [];
      windows.forEach((win, rank) => {
        const rect = win.getBoundingClientRect();
        const covered = windows.slice(0, rank).map((other) => other.getBoundingClientRect());
        for (const fx of [0.1, 0.5, 0.9])
          for (const fy of [0.1, 0.3, 0.5]) {
            const x = rect.left + rect.width * fx;
            const y = rect.top + rect.height * fy;
            if (covered.some((c) => x >= c.left && x <= c.right && y >= c.top && y <= c.bottom))
              continue;
            const hit = document.elementFromPoint(x, y);
            if (!hit || !win.contains(hit))
              problems.push(
                `${win.dataset.panel} at ${fx},${fy} hit ${hit?.tagName}.${hit?.className}`,
              );
          }
      });
      return problems;
    });

  expect(await stackingProblems()).toEqual([]);

  const windowCount = await page.locator('.ui-window').count();
  for (let i = 0; i < windowCount; i++) {
    const win = page.locator('.ui-window').nth(i);
    await win.dispatchEvent('pointerdown');
    const top = await page.evaluate(() => {
      const [front] = [...document.querySelectorAll<HTMLElement>('.ui-window')].sort(
        (a, b) => Number(b.style.zIndex) - Number(a.style.zIndex),
      );
      const rect = front!.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { panel: front!.dataset.panel, contained: front!.contains(hit) };
    });
    expect(top.contained, `${top.panel} fully covers windows beneath`).toBe(true);
    expect(await stackingProblems()).toEqual([]);
  }

  const background = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.ui-window')].map(
      (win) => getComputedStyle(win).backgroundColor,
    ),
  );
  for (const color of background) expect(color).not.toBe('rgba(0, 0, 0, 0)');
});
