// usage: tsx capture.mts <baseUrl> <scenesDir> <outDir> <prefix>
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
const [base, scenes, out, prefix] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const manifest = JSON.parse(readFileSync(`${scenes}/manifest.json`, 'utf8'));
const only = process.env.ONLY?.split(',');
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
for (const backend of ['webgl2', 'canvas2d'] as const) {
  for (const slug of Object.keys(manifest)) {
    if (only && !only.includes(slug)) continue;
    const ctx = await browser.newContext({ viewport: slug === 'lineup' ? { width: 2400, height: 1100 } : { width: 1280, height: 800 }, serviceWorkers: 'block' });
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
    await toolbar.getByRole('button', { name: 'Game options', exact: true }).click();
    await page.getByRole('button', { name: 'Save, load and quit…' }).click();
    await page.getByRole('button', { name: 'Import save file' }).click();
    await page.locator('.save-menu input[type="file"]').setInputFiles(`${scenes}/${slug}.ocsave`);
    await page.locator('.save-menu').waitFor({ state: 'hidden' });
    await page.locator('.hud').filter({ hasText: backend === 'webgl2' ? 'WebGL2' : 'Canvas2D' }).waitFor();
    await toolbar.getByRole('button', { name: 'Pause', exact: true }).click();
    // hide UI chrome except the map
    await page.addStyleTag({ content: '.game-toolbar,.hud,.objective-strip,.tool-status,.ui-windows{visibility:hidden!important}' });
    for (let rot = 0; rot < 4; rot++) {
      await page.evaluate(async ({ f, rot }) => {
        const { project } = await import('/src/render/projection.ts');
        const w = window as any;
        const o = new Float64Array(2);
        project(f[0], f[1], f[2], w.__map.width, w.__map.height, rot, o);
        w.__camera.rotation = rot; w.__camera.x = o[0]; w.__camera.y = o[1];
        if (w.__camera.zoom !== undefined && !w.__zoomLogged) { w.__zoomLogged = true; console.log('zoom', w.__camera.zoom); }
      }, { f: manifest[slug].focus, rot });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${out}/${prefix}-${slug}-${backend}-r${rot}.png` });
    }
    console.log('done', prefix, slug, backend);
    await ctx.close();
  }
}
await browser.close();
