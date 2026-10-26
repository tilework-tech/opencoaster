import { mkdirSync } from 'node:fs';
import { chromium, test, expect } from '@playwright/test';
import { backgroundPixels, loadTerrainFixture } from './support/terrain-fixture';
import type { TerrainFixtureName } from './support/terrain-fixture';

/** `corner` shows the map border and is only captured for proofs: its rectangle leaves the map. */
const FIXTURES: TerrainFixtureName[] = process.env.TERRAIN_PROOF_DIR
  ? ['pit', 'plateau', 'terraces', 'corner']
  : ['pit', 'plateau', 'terraces'];
/** Single-pixel seams where two faces meet at a silhouette corner; a missing face costs thousands. */
const SEAM_SPECKS = 128;
const proofDir = process.env.TERRAIN_PROOF_DIR;

const RENDERERS = [
  {
    name: 'webgl2',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  },
  { name: 'canvas2d', args: ['--disable-gpu', '--disable-3d-apis'] },
];

for (const renderer of RENDERERS) {
  test.describe(`terrain edge faces (${renderer.name})`, () => {
    for (const fixture of FIXTURES) {
      for (const rotation of [0, 1, 2, 3]) {
        test(`${fixture} leaves no background at step edges, rotation ${rotation}`, async () => {
          const browser = await chromium.launch({ args: renderer.args });
          const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
          await page.goto(`${process.env.BASE_URL ?? 'http://127.0.0.1:4173'}/`);
          await page.getByRole('button', { name: 'Sandbox' }).click();
          await page.waitForFunction(() => '__map' in window && '__camera' in window);
          await page.addStyleTag({ content: '#app > *:not(#game){display:none !important}' });
          const { rect } = await loadTerrainFixture(page, fixture, rotation);
          await page.waitForTimeout(1200);
          if (proofDir) {
            mkdirSync(proofDir, { recursive: true });
            await page.screenshot({
              path: `${proofDir}/${renderer.name}-${fixture}-r${rotation}.png`,
            });
          }
          const { count, sample } = await backgroundPixels(page, rect);
          await browser.close();
          if (fixture !== 'corner')
            expect(count, `background pixel at ${sample}`).toBeLessThanOrEqual(SEAM_SPECKS);
        });
      }
    }
  });
}
