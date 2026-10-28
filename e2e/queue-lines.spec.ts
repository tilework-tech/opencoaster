import { expect, test } from './support/test';
import {
  LONG_QUEUE,
  SHORT_QUEUE,
  buildQueuedRide,
  openPage,
  probe,
  screenshot,
  startOpenGrounds,
} from './queue-helpers';
import type { SimProbe } from './queue-helpers';

const onQueueTile = (p: SimProbe, g: { x: number; y: number }): boolean =>
  p.queueTiles.includes(g.y * p.width + g.x);

for (const mobile of [false, true]) {
  const lift = mobile ? 0.25 : 0.5;
  test.describe(mobile ? 'queue lines (Pixel 8)' : 'queue lines (desktop)', () => {
    test('guests queue single file in order, spaced apart, and wanderers never enter the line', async ({
      browser,
    }, testInfo) => {
      test.setTimeout(480_000);
      const page = await openPage(browser, mobile);
      page.setDefaultTimeout(15_000);
      await startOpenGrounds(page);
      await buildQueuedRide(page, testInfo, LONG_QUEUE, lift, mobile);

      const joined = new Map<number, number>();
      const lastDistance = new Map<number, number>();
      const leavers = new Set<number>();
      let peak = 0;
      let screenshotted = false;
      const deadline = Date.now() + 200_000;
      while (Date.now() < deadline && peak < 4) {
        await page.waitForTimeout(300);
        const p = await probe(page);
        const queuing = p.guests.filter((g) => g.state === 1);
        for (const g of queuing) {
          if (!joined.has(g.id)) joined.set(g.id, p.tick);
          const distance = (LONG_QUEUE.entrance.x + 0.5) * 256 - g.px;
          if (distance > (lastDistance.get(g.id) ?? 0)) leavers.add(g.id);
          lastDistance.set(g.id, distance);
        }
        for (const g of p.guests) {
          if (g.state === 0)
            expect(onQueueTile(p, g), `wanderer ${g.id} on a queue tile`).toBe(false);
        }
        const line = queuing
          .filter((g) => !leavers.has(g.id))
          .map((g) => ({ id: g.id, distance: (LONG_QUEUE.entrance.x + 0.5) * 256 - g.px }))
          .sort((a, b) => a.distance - b.distance);
        for (let i = 1; i < line.length; i++) {
          expect(
            line[i]!.distance - line[i - 1]!.distance,
            'queued guests stand a spacing apart',
          ).toBeGreaterThanOrEqual(48);
          expect(
            joined.get(line[i]!.id)!,
            `guest ${line[i]!.id} joined before the guest ahead of it`,
          ).toBeGreaterThanOrEqual(joined.get(line[i - 1]!.id)!);
        }
        peak = Math.max(peak, queuing.length);
        if (!screenshotted && queuing.length >= 4) {
          screenshotted = true;
          await screenshot(page, testInfo, 'queue-moving');
        }
      }
      expect(peak, 'guests queued').toBeGreaterThanOrEqual(4);
    });

    test('a full queue turns guests away', async ({ freshBrowser: browser }, testInfo) => {
      test.setTimeout(480_000);
      const page = await openPage(browser, mobile);
      page.setDefaultTimeout(15_000);
      await startOpenGrounds(page);
      await buildQueuedRide(page, testInfo, SHORT_QUEUE, lift, mobile, { queueLimit: 3 });

      let turnedAway = 0;
      let fullest = 0;
      const deadline = Date.now() + 200_000;
      while (Date.now() < deadline && !(turnedAway > 0 && fullest > 0)) {
        await page.waitForTimeout(300);
        const p = await probe(page);
        const capacity = p.ride!.capacity;
        expect(
          p.ride!.queueLength,
          'the line never holds more than its capacity',
        ).toBeLessThanOrEqual(capacity);
        expect(capacity).toBeLessThanOrEqual(3);
        fullest = Math.max(fullest, p.ride!.queueLength);
        turnedAway = Math.max(turnedAway, p.turnedAway);
      }
      expect(fullest, 'the line filled up').toBeGreaterThan(0);
      expect(turnedAway, 'guests turned away from the full line').toBeGreaterThan(0);
      await screenshot(page, testInfo, 'queue-full');
    });
  });
}
