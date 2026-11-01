import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { devices, expect, test } from '@playwright/test';
import type { Page, Request } from '@playwright/test';
import { project } from '../src/render/projection';

/**
 * Screenshots of the remixed hard parks for the PR proof: the scenario list entry, a whole-map
 * overview and the gate on a fresh game, and the built proof park (see bench/hard-parks.test.ts,
 * run with HARD_PROOF_SAVES) at its characteristic spot. Runs only when HARD_PROOF_DIR names the
 * output directory; CANVAS2D=1 selects Canvas2D and MOBILE=1 the Pixel 8 viewport.
 */
const proofDir = process.env.HARD_PROOF_DIR;
const savesDir = process.env.HARD_PROOF_SAVES;
const useCanvas2d = process.env.CANVAS2D === '1';
const mobile = process.env.MOBILE === '1';
const tag = `${useCanvas2d ? 'canvas2d' : 'webgl2'}-${mobile ? 'mobile' : 'desktop'}`;

const PARKS = [
  { id: 'copper-ridge', name: 'Copper Ridge', tab: 'Challenging Parks', gate: [46, 84, 8] },
  { id: 'tidewater-docks', name: 'Tidewater Docks', tab: 'Challenging Parks', gate: [12, 47, 6] },
  { id: 'mossgrove-isle', name: 'Mossgrove Isle', tab: 'Challenging Parks', gate: [35, 46, 6] },
  { id: 'thunderhead-mesa', name: 'Thunderhead Mesa', tab: 'Expert Parks', gate: [46, 13, 16] },
  { id: 'glacier-point', name: 'Glacier Point', tab: 'Expert Parks', gate: [87, 52, 12] },
] as const satisfies ReadonlyArray<{ gate: readonly [number, number, number] }>;

interface ProofWindow {
  __sim: { map: { width: number; height: number }; setPaused(paused: boolean): void };
  __camera: { x: number; y: number; zoom: number; rotation: number };
}

if (mobile) test.use({ ...devices['Pixel 8'], defaultBrowserType: undefined } as never);

/** Every sprite page the renderer asked for has been served and nothing new was asked for lately. */
function spriteIdleTracker(page: Page) {
  let pending = 0;
  let last = Date.now();
  const atlas = (r: Request) => /\/sprites\//.test(r.url());
  page.on('request', (r) => {
    if (atlas(r)) {
      pending++;
      last = Date.now();
    }
  });
  const done = (r: Request) => {
    if (atlas(r)) {
      pending--;
      last = Date.now();
    }
  };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return async () => {
    const deadline = Date.now() + 60_000;
    while (pending > 0 || Date.now() - last < 1500) {
      if (Date.now() > deadline) throw new Error('sprite pages did not finish loading');
      await page.waitForTimeout(100);
    }
  };
}

async function look(page: Page, tile: readonly [number, number, number], zoom: number) {
  const size = await page.evaluate(() => (window as unknown as ProofWindow).__sim.map);
  const at = new Float64Array(2);
  project(tile[0] * 256 + 128, tile[1] * 256 + 128, tile[2] * 64, size.width, size.height, 0, at);
  await page.evaluate(
    ([x, y, z]) => {
      const camera = (window as unknown as ProofWindow).__camera;
      camera.x = x!;
      camera.y = y!;
      camera.zoom = z!;
      camera.rotation = 0;
    },
    [at[0], at[1], zoom],
  );
  await page.mouse.move(2, 2);
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(1200);
  writeFileSync(join(proofDir!, `${name}-${tag}.png`), await page.screenshot());
}

async function useRenderer(page: Page): Promise<void> {
  if (!useCanvas2d) return;
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
      return original.call(this, type as '2d', ...(args as []));
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
}

for (const park of PARKS) {
  test(`${park.name}: scenario list, overview, gate and built proof`, async ({ page }) => {
    test.skip(!proofDir, 'set HARD_PROOF_DIR');
    test.setTimeout(600_000);
    mkdirSync(proofDir!, { recursive: true });
    await useRenderer(page);
    if (process.env.SMALL === '1') await page.setViewportSize({ width: 960, height: 640 });
    const idle = spriteIdleTracker(page);

    await page.goto('/');
    await page.getByRole('button', { name: 'New game' }).click();
    await page.getByRole('tab', { name: park.tab }).click();
    const card = page.locator('.scenario-card').filter({ hasText: park.name });
    await card.getByRole('button', { name: park.name, exact: true }).click();
    await expect(page.locator('.scenario-preview-panel')).toContainText('Terrain:');
    await expect(page.locator('.scenario-preview-panel')).toContainText('Park rules:');
    await shot(page, `${park.id}-select`);

    await card.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.locator('.hud')).toContainText(useCanvas2d ? 'Canvas2D' : 'WebGL2');
    await page.evaluate(() => (window as unknown as ProofWindow).__sim.setPaused(true));
    const size = await page.evaluate(() => (window as unknown as ProofWindow).__sim.map);
    const viewport = page.viewportSize()!;
    const fit = Math.min(viewport.width / (size.width * 64), viewport.height / (size.height * 32));
    await look(page, [size.width / 2, size.height / 2, 6], fit * 0.95);
    await idle();
    await shot(page, `${park.id}-overview`);
    await page.getByRole('button', { name: 'Land rights', exact: true }).click();
    await page.getByRole('button', { name: 'Buy land', exact: true }).click();
    await page.mouse.move(2, 2);
    await page.waitForTimeout(800);
    await shot(page, `${park.id}-ownership`);
    await page.keyboard.press('Escape');

    await look(page, park.gate, mobile ? 0.5 : 1);
    await idle();
    await shot(page, `${park.id}-gate`);
  });
}

for (const park of PARKS) {
  test(`${park.name}: built proof park`, async ({ page }) => {
    test.skip(!proofDir || !savesDir, 'set HARD_PROOF_DIR and HARD_PROOF_SAVES');
    test.setTimeout(600_000);
    mkdirSync(proofDir!, { recursive: true });
    await useRenderer(page);
    if (!mobile && !useCanvas2d) await page.setViewportSize({ width: 960, height: 640 });
    const idle = spriteIdleTracker(page);
    const meta = JSON.parse(readFileSync(join(savesDir!, `${park.id}.json`), 'utf8')) as {
      focus: [number, number, number];
    };
    await page.goto('/');
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles(join(savesDir!, `${park.id}.ocsave`));
    await expect(page.locator('.hud')).toContainText('tick');
    await page.evaluate(() => (window as unknown as ProofWindow).__sim.setPaused(true));
    await look(page, meta.focus, 1);
    await idle();
    await shot(page, `${park.id}-built`);
    await look(page, meta.focus, 0.5);
    await idle();
    await shot(page, `${park.id}-built-wide`);
  });
}

/** Parks played to a win by bench/hard-park-wins.test.ts (run with HARD_PROOF_SAVES). */
const WON = ['tidewater-docks', 'thunderhead-mesa'] as const;

for (const id of WON) {
  test(`${id}: won park at its deadline`, async ({ page }) => {
    test.skip(!proofDir || !savesDir, 'set HARD_PROOF_DIR and HARD_PROOF_SAVES');
    test.setTimeout(600_000);
    mkdirSync(proofDir!, { recursive: true });
    await useRenderer(page);
    const idle = spriteIdleTracker(page);
    const meta = JSON.parse(readFileSync(join(savesDir!, `${id}-won.json`), 'utf8')) as {
      views: Array<[number, number, number]>;
    };
    await page.goto('/');
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles(join(savesDir!, `${id}-won.ocsave`));
    await expect(page.locator('.hud')).toContainText('tick');
    await page.evaluate(() => (window as unknown as ProofWindow).__sim.setPaused(true));
    for (const [k, view] of meta.views.entries()) {
      await look(page, view, 1);
      await idle();
      await shot(page, `${id}-won-view${k + 1}`);
    }
    await look(page, meta.views[0], 0.5);
    await idle();
    await shot(page, `${id}-won-wide`);
    await page.getByRole('button', { name: 'Park', exact: true }).click();
    await expect(page.locator('body')).toContainText('Objective met');
    await shot(page, `${id}-won-park`);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Finances', exact: true }).click();
    await shot(page, `${id}-won-finance`);
  });
}
