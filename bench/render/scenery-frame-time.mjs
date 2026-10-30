/**
 * Frame cost of a dense scenery scene. Usage:
 *   node bench/render/scenery-frame-time.mjs <baseUrl> <webgl2|canvas2d> [extra]
 * `extra` fills a staged block with the model-generated decorations (branch only). Prints JSON:
 * mean rAF callback time (JS render cost) and mean frame interval, over several seconds.
 */
import { chromium } from '@playwright/test';

const [baseUrl, renderer, extra] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript((renderer) => {
  if (renderer === 'canvas2d') {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
      return original.call(this, type, ...args);
    };
  }
  const raf = window.requestAnimationFrame.bind(window);
  window.__frames = { work: [], gaps: [], last: 0, on: false };
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      const start = performance.now();
      cb(t);
      const end = performance.now();
      const f = window.__frames;
      if (f.on) {
        f.work.push(end - start);
        if (f.last) f.gaps.push(start - f.last);
      }
      f.last = start;
    });
}, renderer);
await page.goto(baseUrl);
await page.getByRole('button', { name: 'New game' }).click();
await page
  .locator('.scenario-card')
  .filter({ hasText: 'Starter Park' })
  .getByRole('button', { name: 'Start', exact: true })
  .click();
await page.waitForFunction(() => window.__camera && window.__camera.x !== 0);
if (extra) {
  await page.evaluate(async () => {
    const { SCENERY_CATALOG } = await import('/src/sim/map/scenery.ts');
    const m = window.__map;
    let n = 0;
    for (let y = 30; y < 54; y++)
      for (let x = 20; x < 44; x++) {
        const i = y * m.width + x;
        if ((m.ownership[i] & 1) === 0 || m.slope[i] !== 0) continue;
        const item = 13 + (n++ % (SCENERY_CATALOG.length - 13));
        window.__sim.command({ type: 'placeScenery', x, y, item, rotation: n % 4 });
      }
  });
  await page.waitForTimeout(3000);
}
const stats = await page.evaluate(async () => {
  const c = window.__camera;
  const { project } = await import('/src/render/projection.ts');
  const { TILE_UNITS, Z_STEP } = await import('/src/sim/core/constants.ts');
  const m = window.__map;
  const out = new Float64Array(2);
  project(32 * TILE_UNITS, 42 * TILE_UNITS, 4 * Z_STEP, m.width, m.height, c.rotation, out);
  c.x = out[0];
  c.y = out[1];
  c.zoom = 0.75;
  await new Promise((r) => setTimeout(r, 1500));
  let visible = 0;
  const f = window.__frames;
  f.on = true;
  await new Promise((r) => setTimeout(r, 8000));
  f.on = false;
  const mean = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  const sorted = [...f.work].sort((a, b) => a - b);
  return {
    frames: f.work.length,
    meanWorkMs: mean(f.work),
    p95WorkMs: sorted[Math.floor(sorted.length * 0.95)],
    meanGapMs: mean(f.gaps),
    scenery: m.sceneryCount,
    visible,
  };
});
console.log(JSON.stringify({ baseUrl, renderer, extra: !!extra, ...stats }));
await browser.close();
