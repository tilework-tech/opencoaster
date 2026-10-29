import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { project } from '../../src/render/projection';
import { TILE_UNITS, Z_STEP } from '../../src/sim/core/constants';
import { deserialize } from '../../src/save/save';

const SAVE = process.env.SAVE!;
const LABEL = process.env.LABEL!;
const OUT = process.env.OUT!;
const PORT = process.env.PORT!;

const world = deserialize(new Uint8Array(readFileSync(SAVE)));
const map = world.map;

/** The gate tile and spawn-to-gate route of the saved park: the bend (63,94), gate (64,94), column x=63 south. */
const onRoute = (x: number, y: number) => (x === 63 && y >= 94) || (x === 64 && y === 94);

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const context = browser.contexts()[0]!;
const page = await context.newPage();
await page.setViewportSize({ width: 1280, height: 800 });
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.locator('input[type=file]').first().setInputFiles(SAVE);
await page.locator('.game-toolbar').waitFor({ state: 'visible', timeout: 60_000 });
await page.waitForFunction(() => !!(window as any).__snapshot?.litter, undefined, { timeout: 30_000 });
await page.waitForTimeout(4000);

const stats = () =>
  page.evaluate((routeTiles) => {
    const snap = (window as any).__snapshot;
    const route = new Set(routeTiles);
    let outside = 0, inside = 0, bend = 0;
    for (let i = 0; i < snap.litter.count; i++) {
      const tx = snap.litter.data[i * 4]! >> 8;
      const ty = snap.litter.data[i * 4 + 1]! >> 8;
      if (route.has(`${tx},${ty}`)) { outside++; if (tx === 63 && ty === 94 || tx === 64 && ty === 94) bend++; }
      else inside++;
    }
    return { outsideRoute: outside, onBendAndGate: bend, interior: inside, guests: snap.guests.count, tick: snap.tick };
  }, Array.from({ length: 40 }, (_, i) => `63,${94 + i}`).concat(['64,94']));

async function shot(name: string, tile: { x: number; y: number }, zoom: number) {
  const rotation = await page.evaluate(() => (window as any).__camera.rotation);
  const p = new Float64Array(2);
  project((tile.x + 0.5) * TILE_UNITS, (tile.y + 0.5) * TILE_UNITS, map.heights[map.index(tile.x, tile.y)]! * Z_STEP, map.width, map.height, rotation, p);
  await page.evaluate(([x, y, z]) => { const c = (window as any).__camera; c.x = x; c.y = y; c.zoom = z; }, [p[0]!, p[1]!, zoom]);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${LABEL}-${name}.png` });
}

const log: Record<string, unknown> = {};
log.loaded = await stats();
await shot('1-bend-loaded', { x: 63, y: 95 }, 3);
await shot('2-approach-loaded', { x: 63, y: 102 }, 2);
await shot('3-inside-loaded', { x: 63, y: 91 }, 3);
await page.evaluate(() => { const s = (window as any).__sim; s.command({ type: 'spawnGuests', count: 150 }); s.setSpeed(8); });
for (let i = 0; i < 8; i++) { await page.waitForTimeout(2500); log[`t${i}`] = await stats(); }
await page.evaluate(() => (window as any).__sim.setSpeed(1));
await shot('4-bend-after-traffic', { x: 63, y: 95 }, 3);
await shot('5-approach-after-traffic', { x: 63, y: 102 }, 2);
await shot('6-inside-after-traffic', { x: 63, y: 91 }, 3);
log.final = await stats();
writeFileSync(`${OUT}/${LABEL}-stats.json`, JSON.stringify(log, null, 1));
await page.close();
await browser.close();
