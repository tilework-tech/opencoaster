// usage: tsx capture-preview.mts <baseUrl> <saveFile> <outDir> <prefix>
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';
const [base, save, out, prefix] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const { defaultBrowserType: _t, ...pixel } = devices['Pixel 8']; void _t;
const NAMES = ['east', 'south', 'west', 'north'];
for (const device of ['desktop', 'pixel8'] as const)
for (const backend of ['webgl2', 'canvas2d'] as const) {
  const ctx = await browser.newContext({ ...(device === 'pixel8' ? pixel : { viewport: { width: 1280, height: 800 } }), serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  if (backend === 'canvas2d')
    await page.addInitScript(() => {
      const o = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (t: string, ...a: unknown[]) {
        if (t === 'webgl2' || t === 'webgl' || t === 'experimental-webgl') return null;
        return o.call(this, t as '2d', ...(a as []));
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
  await page.addInitScript('window.__name = (f) => f;');
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
  await page.locator('.save-menu input[type="file"]').setInputFiles(save);
  await page.locator('.save-menu').waitFor({ state: 'hidden' });
  await page.locator('.hud').filter({ hasText: backend === 'webgl2' ? 'WebGL2' : 'Canvas2D' }).waitFor();
  await click('Pause');
  await click('Scenery');
  await page.getByLabel('Scenery category').selectOption({ label: 'Fences and walls' });
  await page.getByLabel('Scenery item').selectOption({ label: 'Wooden fence · $0.60' });
  await page.evaluate(async () => {
    const { project } = await import('/src/render/projection.ts');
    const w = window as any;
    const o = new Float64Array(2);
    project(22.5 * 256, 22.5 * 256, 128, w.__map.width, w.__map.height, 0, o);
    w.__camera.rotation = 0; w.__camera.x = o[0]; w.__camera.y = o[1];
  });
  await page.waitForTimeout(800);
  for (let edge = 0; edge < 4; edge++) {
    const pt = await page.evaluate(async (edge) => {
      const { project } = await import('/src/render/projection.ts');
      const w = window as any;
      const r = document.querySelector('#game')!.getBoundingClientRect();
      const T = 256, x = 22, y = 22;
      const C = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
      const E = [[1, 2], [2, 3], [3, 0], [0, 1]][edge]!;
      const sp = (c: number[]) => {
        const o = new Float64Array(2);
        project(c[0]! * T, c[1]! * T, 128, w.__map.width, w.__map.height, w.__camera.rotation, o);
        return [r.x + r.width / 2 + (o[0] - w.__camera.x) * w.__camera.zoom, r.y + r.height / 2 + (o[1] - w.__camera.y) * w.__camera.zoom];
      };
      const a = sp(C[E[0]!]!), b = sp(C[E[1]!]!), c = sp([x + 0.5, y + 0.5]);
      return [((a[0]! + b[0]!) / 2) * 0.8 + c[0]! * 0.2, ((a[1]! + b[1]!) / 2) * 0.8 + c[1]! * 0.2, c[0]!, c[1]!];
    }, edge);
    await page.mouse.move(pt[0]! - 5, pt[1]! - 5);
    await page.mouse.move(pt[0]!, pt[1]!);
    await page.waitForTimeout(900);
    const file = `${out}/${prefix}-${device}-${backend}-edge${edge}-${NAMES[edge]}.png`;
    const bytes = await page.screenshot({ path: file });
    const meta = await sharp(bytes).metadata();
    const dpr = meta.width! / page.viewportSize()!.width;
    const cw = Math.round(360 * dpr), ch = Math.round(240 * dpr);
    const left = Math.max(0, Math.min(meta.width! - cw, Math.round(pt[2]! * dpr - cw / 2)));
    const top = Math.max(0, Math.min(meta.height! - ch, Math.round(pt[3]! * dpr - ch / 2)));
    await sharp(bytes).extract({ left, top, width: cw, height: ch }).resize({ width: cw * 2, kernel: 'nearest' }).toFile(file.replace('.png', '-crop2x.png'));
  }
  console.log('done', device, backend);
  await ctx.close();
}
await browser.close();
