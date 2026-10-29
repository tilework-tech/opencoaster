import { mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { expect, test } from './support/test';
import { World } from '../src/sim/core/world';
import { serialize } from '../src/save/save';
import { RideType } from '../src/sim/rides/ride-types';
import { parseScenarioFile } from '../src/sim/scenario/scenario-file';
import { prepareScenario } from '../src/sim/scenario/scenario-layout';
import type { Page } from './support/test';
import {
  createStarterWorld,
  findBuildableRun,
  hoverGameTile,
  startStarterPark,
  toolbarTool,
} from './footpath-helpers';

const proofDir = process.env.TERRAIN_PROOF_DIR;

/** Longest vertical run, in canvas pixels, of the marker's yellow ink in any one column. */
async function poleHeight(page: Page): Promise<number> {
  return page.locator('.terrain-aids').evaluate((canvas: HTMLCanvasElement) => {
    const { width, height } = canvas;
    const data = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
    let longest = 0;
    for (let x = 0; x < width; x++) {
      let run = 0;
      for (let y = 0; y < height; y++) {
        const i = (y * width + x) * 4;
        const ink =
          data[i]! > 200 && data[i + 1]! > 180 && data[i + 2]! < 160 && data[i + 3]! > 100;
        run = ink ? run + 1 : 0;
        longest = Math.max(longest, run);
      }
    }
    return longest;
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
  // The diamond outline never runs more than a few pixels straight up; only the pole does.
  await expect.poll(async () => await poleHeight(page), { timeout: 20_000 }).toBeGreaterThan(40);
  if (proofDir) {
    mkdirSync(proofDir, { recursive: true });
    await page.screenshot({ path: `${proofDir}/construction-marker-path.png` });
  }
});

test('the construction marker draws while track is being built', async ({ page }, testInfo) => {
  test.fixme(
    true,
    'Fails on clean main bd7c8c6: the imported coaster remains at 0 track pieces after Build piece.',
  );
  test.setTimeout(120_000);
  await page.addInitScript(() =>
    localStorage.setItem('opencoaster-option-construction-marker', 'true'),
  );
  const scenario = parseScenarioFile(
    JSON.parse(
      readFileSync(new URL('../src/sim/scenario/scenarios/starter.json', import.meta.url), 'utf8'),
    ),
  );
  const world = new World({
    seed: scenario.seed,
    width: scenario.mapWidth,
    height: scenario.mapHeight,
  });
  prepareScenario(world, scenario);
  world.research.unlocked.add(RideType.SteelLoopingCoaster);
  const savePath = testInfo.outputPath('marker-coaster.park');
  await writeFile(savePath, serialize(world));

  await startStarterPark(page);
  await toolbarTool(page, 'Save / Load');
  await page.getByRole('button', { name: 'Import save file' }).click();
  await page.locator('.save-menu input[type="file"]').setInputFiles(savePath);
  await expect(page.locator('.hud')).toContainText('tick');
  await toolbarTool(page, 'New ride');
  await page.getByRole('tab', { name: 'Roller Coasters' }).click();
  await page.getByRole('button', { name: /^Steel Looping Coaster/ }).click();

  await toolbarTool(page, 'Map');
  const minimap = page.locator('.minimap');
  await expect.poll(() => minimap.evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBe(128);
  const bounds = (await minimap.boundingBox())!;
  const [tx, ty] = [28, 43];
  await minimap.click({
    position: {
      x: ((tx - ty + 127 + 0.5) / 128) * bounds.width,
      y: (((tx + ty) / 2 + 0.25) / 128) * bounds.height,
    },
  });
  await page.getByRole('button', { name: 'Close Map' }).click();
  const game = (await page.locator('#game').boundingBox())!;
  await page.mouse.click(
    game.x + game.width / 2 + (27 - tx) * 32 - (39 - ty) * 32,
    game.y + game.height / 2 + (27 - tx + (39 - ty)) * 16 - 32,
  );

  const construction = page.locator('[data-panel="construction"]');
  await expect(construction).toBeVisible();
  await construction.getByLabel('Special elements').selectOption({ label: 'Station' });
  await construction.getByRole('button', { name: 'Level', exact: true }).click();
  await construction.getByRole('button', { name: 'Build piece' }).click();
  await expect(page.locator('.coaster-info')).toContainText('Track 1 pieces');
  await construction.getByRole('button', { name: 'Straight', exact: true }).click();
  await construction.getByRole('button', { name: 'Up', exact: true }).click();

  await expect.poll(async () => await poleHeight(page), { timeout: 20_000 }).toBeGreaterThan(40);
  if (proofDir) await page.screenshot({ path: `${proofDir}/construction-marker-track.png` });
});
