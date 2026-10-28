import { expect, test } from './support/test';
import {
  SNAKE_QUEUE,
  buildQueuedRide,
  openPage,
  probe,
  screenshot,
  setSpeed,
  startOpenGrounds,
} from './queue-helpers';

/** Snake tiles from the open end to the entrance, as the three drags lay them. */
const ORDER = [...SNAKE_QUEUE.queue, SNAKE_QUEUE.entrance].map((t) => `${t.x},${t.y}`);

for (const mobile of [false, true]) {
  test.describe(mobile ? 'snake queue (Pixel 8)' : 'snake queue (desktop)', () => {
    test('guests walk the whole snake in order, never across a rail', async ({
      freshBrowser: browser,
    }, testInfo) => {
      test.setTimeout(600_000);
      const page = await openPage(browser, mobile);
      page.setDefaultTimeout(15_000);
      await startOpenGrounds(page);
      await buildQueuedRide(page, testInfo, SNAKE_QUEUE, mobile ? 0.25 : 0.5, mobile);
      await setSpeed(page, 1);

      const furthest = new Map<number, number>();
      const visitsByGuest = new Map<number, Set<number>>();
      let screenshotted = false;
      let completedGuest = false;
      const deadline = Date.now() + 300_000;
      while (Date.now() < deadline && !completedGuest) {
        await page.waitForTimeout(150);
        const p = await probe(page);
        const queuing = p.guests.filter((g) => g.state === 1);
        for (const g of queuing) {
          const at = ORDER.indexOf(`${g.x},${g.y}`);
          if (at < 0) continue;
          const before = furthest.get(g.id) ?? -1;
          expect(at, `guest ${g.id} stepped back or jumped across a rail`).toBeGreaterThanOrEqual(
            before,
          );
          if (before >= 0)
            expect(at - before, `guest ${g.id} skipped tiles`).toBeLessThanOrEqual(2);
          furthest.set(g.id, at);
          let visits = visitsByGuest.get(g.id);
          if (!visits) {
            visits = new Set<number>();
            visitsByGuest.set(g.id, visits);
          }
          visits.add(at);
          if (at === ORDER.length - 1 && visits.size === ORDER.length) completedGuest = true;
        }
        if (!screenshotted && queuing.length >= 6) {
          screenshotted = true;
          await screenshot(page, testInfo, 'snake-queuing');
        }
      }
      expect(completedGuest, 'one guest walked from the open end to the ride entrance').toBe(true);
      expect(
        [...visitsByGuest.values()].some(
          (visits) => visits.size === ORDER.length && ORDER.every((_, k) => visits.has(k)),
        ),
        'one guest visited every snake tile from the open end to the ride entrance',
      ).toBe(true);
    });
  });
}
