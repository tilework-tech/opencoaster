// usage: tsx capture-ship.mts <baseUrl> <scenesDir> <outDir> <backend: webgl2|canvas2d>
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import sharp from 'sharp';
const [base, scenes, out, backend] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const manifest = JSON.parse(readFileSync(`${scenes}/manifest.json`, 'utf8'));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const only = process.env.ONLY?.split(',');
for (const slug of manifest.samples as string[]) {
  if (only && !only.includes(slug)) continue;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
page.setDefaultTimeout(90000);
page.on('crash', () => console.log('PAGE CRASH'));
if (backend === 'canvas2d')
  await page.addInitScript(() => {
    const o = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t: string, ...a: unknown[]) {
      if (t === 'webgl2' || t === 'webgl' || t === 'experimental-webgl') return null;
      return o.call(this, t as '2d', ...(a as []));
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
await page.goto(base + '/');
await page.getByRole('button', { name: 'Sandbox' }).click();
const toolbar = page.locator('.game-toolbar');
await toolbar.waitFor();
const click = async (name: string) => {
  const b = toolbar.getByRole('button', { name, exact: true });
  if (!(await b.isVisible())) {
    const a = toolbar.getByRole('button', { name: 'Actions', exact: true });
    if ((await a.getAttribute('aria-expanded')) !== 'true') await a.click();
  }
  await b.click();
};

  await click('Game options');
  await page.getByRole('button', { name: 'Save, load and quit…' }).click();
  await page.getByRole('button', { name: 'Import save file' }).click();
  await page.locator('.save-menu input[type="file"]').setInputFiles(`${scenes}/${slug}.ocsave`);
  await page.locator('.save-menu').waitFor({ state: 'hidden' });
  await page.locator('.hud').filter({ hasText: backend === 'webgl2' ? 'WebGL2' : 'Canvas2D' }).waitFor();
  await click('Pause');
  await page.addStyleTag({ content: '.game-toolbar,.hud,.objective-strip,.tool-status,.ui-windows,.minimap{visibility:hidden!important}' });
  for (let rot = 0; rot < 4; rot++) {
    await page.evaluate(async ({ f, rot }) => {
      const { project } = await import('/src/render/projection.ts');
      const w = window as any;
      const o = new Float64Array(2);
      project(f[0], f[1], f[2], w.__map.width, w.__map.height, rot, o);
      w.__camera.rotation = rot; w.__camera.x = o[0]; w.__camera.y = o[1];
    }, { f: manifest.focus, rot });
    await page.waitForTimeout(1200);
    const bytes = await page.screenshot({ path: `${out}/${slug}-r${rot}.png` });
    console.log(slug, 'r' + rot, 'bytes', bytes.length);
  }
  await ctx.close();
}
await browser.close();
