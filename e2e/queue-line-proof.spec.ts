import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { test } from './support/test';
import type { Page } from './support/test';
import {
  SNAKE_QUEUE,
  buildQueuedRide,
  focus,
  openPage,
  probe,
  startOpenGrounds,
} from './queue-helpers';

/**
 * Captures proof frames of a busy snake queue at the default zoom, one per camera rotation, for the
 * WebGL2 and Canvas2D renderers. Set QUEUE_PROOF=<label> and QUEUE_BASE for the build under test;
 * frames land in .local/queue-proof/<label>. Not part of the normal suite.
 */
const LABEL = process.env.QUEUE_PROOF;
const BASE = process.env.QUEUE_BASE ?? 'http://127.0.0.1:4173';
const OUT = `.local/queue-proof/${LABEL}`;
const CENTRE = { x: 50, y: 65 };

async function closeWindows(page: Page): Promise<void> {
  const closeButtons = page.locator('.ui-window button[aria-label^="Close"]');
  while (await closeButtons.count()) await closeButtons.first().click();
}

async function frame(page: Page, canvas2d: boolean): Promise<Buffer> {
  if (!canvas2d) return page.locator('#game').screenshot({ timeout: 120_000 });
  const url = await page.evaluate(() =>
    (document.querySelector('#game') as HTMLCanvasElement).toDataURL('image/png'),
  );
  return Buffer.from(url.split(',')[1]!, 'base64');
}

for (const renderer of ['webgl2', 'canvas2d'] as const) {
  test(`${LABEL} ${renderer}`, async ({ freshBrowser: browser }, testInfo) => {
    test.skip(!LABEL, 'proof capture only');
    test.setTimeout(900_000);
    await mkdir(OUT, { recursive: true });
    const page = await openPage(browser, false, {
      canvas2d: renderer === 'canvas2d',
      baseURL: BASE,
    });
    page.setDefaultTimeout(15_000);
    await startOpenGrounds(page);
    await buildQueuedRide(page, testInfo, SNAKE_QUEUE, 0.5, false);
    const deadline = Date.now() + 300_000;
    let line = 0;
    while (Date.now() < deadline && line < 12) {
      await page.waitForTimeout(1_000);
      line = (await probe(page)).ride?.queueLength ?? 0;
    }
    while (Date.now() < deadline && (await probe(page)).weather >= 2)
      await page.waitForTimeout(1_000);
    await closeWindows(page);
    await page.mouse.move(5, 5);
    const frames: Buffer[] = [];
    for (const rotation of [0, 1, 2, 3] as const) {
      await focus(page, CENTRE, 0.5, { rotation });
      await page.waitForTimeout(800);
      const bytes = await frame(page, renderer === 'canvas2d');
      await sharp(bytes).toFile(`${OUT}/${renderer}-rot${rotation}.png`);
      frames.push(bytes);
    }
    const tiles = await Promise.all(
      frames.map((bytes) => sharp(bytes).resize({ width: 640 }).png().toBuffer()),
    );
    const meta = await sharp(tiles[0]!).metadata();
    await sharp({
      create: {
        width: meta.width! * 4,
        height: meta.height!,
        channels: 3,
        background: '#000',
      },
    })
      .composite(tiles.map((input, k) => ({ input, left: k * meta.width!, top: 0 })))
      .png()
      .toFile(`${OUT}/${renderer}-strip.png`);
    console.log('QUEUELINE', LABEL, renderer, line);
  });
}
