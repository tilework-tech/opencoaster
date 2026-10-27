import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { test } from './support/test';
import type { Page } from './support/test';
import {
  LONG_QUEUE,
  buildQueuedRide,
  focus,
  openPage,
  probe,
  startOpenGrounds,
} from './queue-helpers';

/**
 * Captures close-up proof frames of the queue line (set QUEUE_PROOF=before|after, and QUEUE_BASE for
 * a build served elsewhere). Not part of the normal suite.
 */
const MODE = process.env.QUEUE_PROOF;
const BASE = process.env.QUEUE_BASE ?? 'http://127.0.0.1:4173';
const OUT = '.local/pr-proof/raw';
const CENTRE = { x: 51, y: 64 };

async function closeWindows(page: Page): Promise<void> {
  const closeButtons = page.locator('.ui-window button[aria-label^="Close"]');
  while (await closeButtons.count()) await closeButtons.first().click();
}

async function dry(page: Page): Promise<void> {
  if (MODE !== 'after') return;
  const until = Date.now() + 90_000;
  while (Date.now() < until && (await probe(page)).weather >= 2) await page.waitForTimeout(1_000);
}

async function grab(page: Page, mobile: boolean, name: string, tight = false): Promise<Buffer> {
  await dry(page);
  const box = (await page.locator('#game').boundingBox())!;
  const clip =
    tight && !mobile
      ? { x: box.width / 2 - 340, y: box.height / 2 - 200, width: 680, height: 400 }
      : mobile
        ? { x: 0, y: 56, width: box.width, height: Math.min(box.height - 56, 640) }
        : {
            x: box.width / 2 - 380,
            y: box.height / 2 - 250,
            width: 760,
            height: 500,
          };
  const bytes = await page.screenshot({ clip, timeout: 120_000 });
  await sharp(bytes).toFile(`${OUT}/${name}.png`);
  return bytes;
}

for (const renderer of ['webgl2', 'canvas2d'] as const) {
  for (const mobile of [false, true]) {
    const device = mobile ? 'pixel8' : 'desktop';
    test(`${MODE} ${renderer} ${device}`, async ({ browser }, testInfo) => {
      test.skip(!MODE, 'proof capture only');
      test.setTimeout(1_200_000);
      await mkdir(OUT, { recursive: true });
      const page = await openPage(browser, mobile, {
        canvas2d: renderer === 'canvas2d',
        baseURL: BASE,
        scale: mobile ? undefined : Number(process.env.QUEUE_SCALE ?? 2),
      });
      page.setDefaultTimeout(15_000);
      await startOpenGrounds(page);
      const lift = mobile ? 0.25 : 0.5;
      await buildQueuedRide(page, testInfo, LONG_QUEUE, lift, mobile, {
        legacy: MODE === 'before',
      });
      if (MODE === 'after') {
        const deadline = Date.now() + 150_000;
        while (Date.now() < deadline) {
          const p = await probe(page);
          if (p.guests.filter((g) => g.state === 1).length >= 5) break;
          await page.waitForTimeout(500);
        }
      } else await page.waitForTimeout(60_000);
      await closeWindows(page);
      const actions = page
        .locator('.game-toolbar')
        .getByRole('button', { name: 'Actions', exact: true });
      if ((await actions.count()) > 0 && (await actions.getAttribute('aria-expanded')) === 'true')
        await actions.click();
      if (MODE === 'after') {
        const dry = Date.now() + 120_000;
        while (Date.now() < dry && (await probe(page)).weather >= 2)
          await page.waitForTimeout(1_000);
      }
      await page.mouse.move(5, 5);
      const frames: Buffer[] = [];
      for (const rotation of [0, 1, 2, 3] as const) {
        await focus(page, CENTRE, mobile ? 0.3 : 0.5, { rotation, zoom: 2 });
        await page.waitForTimeout(700);
        frames.push(await grab(page, mobile, `${MODE}-${renderer}-${device}-rot${rotation}`));
      }
      await focus(page, CENTRE, mobile ? 0.3 : 0.5, { rotation: 0, zoom: mobile ? 2 : 3 });
      const strip: Buffer[] = [];
      for (let i = 0; i < 6; i++) {
        await page.waitForTimeout(900);
        strip.push(await grab(page, mobile, `${MODE}-${renderer}-${device}-strip${i}`, true));
      }
      void frames;
      void strip;
    });
  }
}
