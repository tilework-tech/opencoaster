import { expect, test } from './support/test';
import {
  SNAKE_QUEUE,
  buildQueuedRide,
  openPage,
  probe,
  screenshot,
  startOpenGrounds,
} from './queue-helpers';

/** Snake tiles from the entrance out to the open end. */
const CHAIN = [SNAKE_QUEUE.entrance, ...[...SNAKE_QUEUE.queue].reverse()].map(
  (t) => `${t.x},${t.y}`,
);

for (const mobile of [false, true]) {
  test.describe(mobile ? 'queue spacing (Pixel 8)' : 'queue spacing (desktop)', () => {
    test('a busy snake queue spreads guests along the line, never on top of each other', async ({
      browser,
    }, testInfo) => {
      test.setTimeout(600_000);
      const page = await openPage(browser, mobile);
      page.setDefaultTimeout(15_000);
      await startOpenGrounds(page);
      await buildQueuedRide(page, testInfo, SNAKE_QUEUE, mobile ? 0.25 : 0.5, mobile);

      const rideWindow = page.locator('[data-panel="ride-0"]');
      await expect
        .poll(async () => (await probe(page)).ride?.queueLength ?? 0, { timeout: 240_000 })
        .toBeGreaterThanOrEqual(12);

      const p = await probe(page);
      const line = p.guests.filter((g) => g.state === 1 || g.state === 5);
      const positions = line.map((g) => `${g.px},${g.py}`);
      expect(new Set(positions).size, 'every guest in line has its own spot').toBe(line.length);
      for (let i = 0; i < line.length; i++) {
        for (let j = i + 1; j < line.length; j++) {
          const gap = Math.abs(line[i]!.px - line[j]!.px) + Math.abs(line[i]!.py - line[j]!.py);
          expect(gap, `guests ${line[i]!.id} and ${line[j]!.id} overlap`).toBeGreaterThanOrEqual(
            48,
          );
        }
      }
      const tiles = new Set(
        line.map((g) => CHAIN.indexOf(`${g.x},${g.y}`)).filter((index) => index >= 0),
      );
      expect(tiles.size, 'the line stretches over several tiles').toBeGreaterThanOrEqual(4);

      const shown = Number(
        (
          await rideWindow
            .getByText(/^\d+ of \d+$/)
            .first()
            .innerText()
        ).split(' ')[0],
      );
      expect(
        Math.abs(shown - line.length),
        'ride window length matches the line',
      ).toBeLessThanOrEqual(2);
      await screenshot(page, testInfo, 'queue-spacing');
    });
  });
}
