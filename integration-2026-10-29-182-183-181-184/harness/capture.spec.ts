import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { centerCameraOn } from '../../e2e/footpath-helpers';
import { deserialize } from '../../src/save/save';

const SAVE = process.env.SAVE!;
const LABEL = process.env.LABEL!;
const OUT = process.env.OUT!;

interface Stats {
  outside: number;
  inside: number;
  guests: number;
  broken?: number;
}

test(`exterior mess ${LABEL}`, async ({ page }) => {
  test.setTimeout(600_000);
  const bytes = readFileSync(SAVE);
  const world = deserialize(new Uint8Array(bytes));
  const gate = { x: world.park.entranceX, y: world.park.entranceY };
  const gy = gate.y;
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles(SAVE);
  await expect(page.locator('.game-toolbar')).toBeVisible();
  await page.waitForFunction(
    () => !!(window as unknown as { __snapshot?: { litter?: unknown } }).__snapshot?.litter,
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(4000);

  const stats = async (): Promise<Stats> => {
    await page.waitForFunction(
      () => !!(window as unknown as { __snapshot?: unknown }).__snapshot,
      undefined,
      { timeout: 30_000 },
    );
    return page.evaluate((gateY) => {
      const snap = (
        window as unknown as {
          __snapshot: { litter: { count: number; data: Int32Array }; guests: { count: number } };
        }
      ).__snapshot;
      let outside = 0,
        inside = 0;
      for (let i = 0; i < snap.litter.count; i++) {
        const ty = snap.litter.data[i * 4 + 1]! >> 8;
        if (ty > gateY) outside++;
        else inside++;
      }
      return { outside, inside, guests: snap.guests.count };
    }, gy);
  };

  const shot = async (name: string, tile: { x: number; y: number }, zoom = 2) => {
    await centerCameraOn(page, world, tile, zoom);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/${LABEL}-${name}.png` });
  };
  const log: Record<string, Stats> = {};
  log.loaded = await stats();
  await shot('1-gate-loaded', { x: gate.x, y: gate.y + 6 });
  await shot('2-approach-loaded', { x: gate.x, y: gate.y + 16 });
  await shot('3-inside-loaded', { x: gate.x, y: gate.y - 6 });

  // Heavy guest traffic at 4x so arrivals, admission and departures all pass the gate.
  await page.evaluate(() => {
    const sim = (
      window as unknown as { __sim: { command(c: unknown): void; setSpeed(m: number): void } }
    ).__sim;
    sim.command({ type: 'spawnGuests', count: 150 });
    sim.setSpeed(8);
  });
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(2500);
    log[`t${i}`] = await stats();
  }
  await page.evaluate(() => (window as unknown as { __sim: { setSpeed(m: number): void } }).__sim.setSpeed(1));
  await shot('4-gate-after-traffic', { x: gate.x, y: gate.y + 6 });
  await shot('5-approach-after-traffic', { x: gate.x, y: gate.y + 16 });
  await shot('6-inside-after-traffic', { x: gate.x, y: gate.y - 6 });
  log.final = await stats();
  writeFileSync(`${OUT}/${LABEL}-stats.json`, JSON.stringify(log, null, 1));
  expect(true).toBe(true);
});
