import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  createStarterWorld,
  findBuildableRun,
  hoverGameTile,
  startStarterPark,
  toolbarTool,
} from './footpath-helpers';

const proofDir = process.env.TERRAIN_PROOF_DIR;

/** Bounding box, in canvas pixels, of the marker's yellow ink on the terrain-aids canvas. */
async function markerExtent(page: Page): Promise<{ width: number; height: number }> {
  return page.locator('.terrain-aids').evaluate((canvas: HTMLCanvasElement) => {
    const { width, height } = canvas;
    const data = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
    let [minX, minY, maxX, maxY] = [width, height, -1, -1];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i]! < 200 || data[i + 1]! < 180 || data[i + 2]! > 160 || data[i + 3]! < 100)
        continue;
      const x = (i / 4) % width;
      const y = Math.floor(i / 4 / width);
      [minX, minY, maxX, maxY] = [
        Math.min(minX, x),
        Math.min(minY, y),
        Math.max(maxX, x),
        Math.max(maxY, y),
      ];
    }
    return { width: maxX - minX + 1, height: maxY - minY + 1 };
  });
}

test('the construction marker draws while a footpath is being placed', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('opencoaster-option-construction-marker', 'true'),
  );
  const world = createStarterWorld();
  const [tile] = findBuildableRun(world, 1, { x: 28, y: 42 });
  await startStarterPark(page);
  await toolbarTool(page, 'Footpaths');
  await hoverGameTile(page, world, tile!);
  // A bare diamond is about 32 CSS pixels tall; the pole makes the marker clearly taller.
  await expect.poll(async () => (await markerExtent(page)).height).toBeGreaterThan(70);
  if (proofDir) {
    mkdirSync(proofDir, { recursive: true });
    await page.screenshot({ path: `${proofDir}/construction-marker-path.png` });
  }
});
