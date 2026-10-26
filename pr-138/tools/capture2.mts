// usage: tsx capture2.mts <baseUrl> <scenesDir> <outDir> <prefix>
import { chromium, devices } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import sharp from 'sharp';
const [base, scenes, out, prefix] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const manifest = JSON.parse(readFileSync(`${scenes}/manifest.json`, 'utf8'));
const only = process.env.ONLY?.split(',');
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const { defaultBrowserType: _t, ...pixel } = devices['Pixel 8']; void _t;
for (const device of ['desktop'] as const)
for (const backend of ['webgl2', 'canvas2d'] as const)
for (const slug of Object.keys(manifest)) {
  if (only && !only.includes(slug)) continue;
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
      if (!w.__zl) { w.__zl = 1; console.log('zoom', w.__camera.zoom); }
    }, { f: manifest[slug].focus, rot });
    await page.waitForTimeout(1500);
    const file = `${out}/${prefix}-${device}-${slug}-${backend}-r${rot}.png`;
    const bytes = await page.screenshot({ path: file });
    if (manifest[slug].crop) {
      const meta = await sharp(bytes).metadata();
      const dpr = device === 'pixel8' ? meta.width! / page.viewportSize()!.width : 1;
      const w = Math.round(260 * dpr), h = Math.round(130 * dpr);
      await sharp(bytes).extract({ left: Math.round(meta.width! / 2 - w / 2), top: Math.round(meta.height! / 2 - h / 2), width: w, height: h })
        .resize({ width: w * 2, height: h * 2, kernel: 'nearest' }).toFile(file.replace('.png', '-crop2x.png'));
    }
  }
  console.log('done', prefix, device, slug, backend);
  await ctx.close();
}
await browser.close();
