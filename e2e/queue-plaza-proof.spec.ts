import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  BLOCK_QUEUE,
  SNAKE_QUEUE,
  buildQueuedRide,
  focus,
  openPage,
  probe,
  startOpenGrounds,
} from './queue-helpers';

/**
 * Captures proof frames of side-by-side queue builds (set PLAZA_PROOF=<label>, and PLAZA_BASE for a
 * build served elsewhere). Not part of the normal suite.
 */
const LABEL = process.env.PLAZA_PROOF;
const BASE = process.env.PLAZA_BASE ?? 'http://127.0.0.1:4173';
const OUT = '.local/pr-proof/raw';
const CENTRE = { x: 51, y: 65 };

async function closeWindows(page: Page): Promise<void> {
  const closeButtons = page.locator('.ui-window button[aria-label^="Close"]');
  while (await closeButtons.count()) await closeButtons.first().click();
}

const SCENES = { block: BLOCK_QUEUE, snake: SNAKE_QUEUE } as const;

for (const renderer of ['webgl2', 'canvas2d'] as const) {
  for (const [scene, layout] of Object.entries(SCENES)) {
    test(`${LABEL} ${scene} ${renderer}`, async ({ browser }, testInfo) => {
      test.skip(!LABEL, 'proof capture only');
      test.setTimeout(900_000);
      await mkdir(OUT, { recursive: true });
      const page = await openPage(browser, false, {
        canvas2d: renderer === 'canvas2d',
        baseURL: BASE,
        scale: 2,
      });
      page.setDefaultTimeout(15_000);
      await startOpenGrounds(page);
      await buildQueuedRide(page, testInfo, layout, 0.5, false);
      const deadline = Date.now() + 200_000;
      while (Date.now() < deadline) {
        const p = await probe(page);
        if (p.guests.filter((g) => g.state === 1).length >= 8) break;
        await page.waitForTimeout(500);
      }
      await closeWindows(page);
      const actions = page
        .locator('.game-toolbar')
        .getByRole('button', { name: 'Actions', exact: true });
      if ((await actions.count()) > 0 && (await actions.getAttribute('aria-expanded')) === 'true')
        await actions.click();
      const dry = Date.now() + 120_000;
      while (Date.now() < dry && (await probe(page)).weather >= 2) await page.waitForTimeout(1_000);
      await page.mouse.move(5, 5);
      for (const rotation of [0, 1, 2, 3] as const) {
        await focus(page, CENTRE, 0.5, { rotation, zoom: 3 });
        await page.waitForTimeout(700);
        const box = (await page.locator('#game').boundingBox())!;
        const clip = {
          x: box.width / 2 - 380,
          y: box.height / 2 - 250,
          width: 760,
          height: 500,
        };
        const bytes = await page.screenshot({ clip, timeout: 120_000 });
        await sharp(bytes).toFile(`${OUT}/${LABEL}-${scene}-${renderer}-rot${rotation}.png`);
      }
    });
  }
}
