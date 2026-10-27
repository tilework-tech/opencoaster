import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { TILE_UNITS, Z_STEP } from '../src/sim/core/constants';
import { World } from '../src/sim/core/world';
import { OWNED } from '../src/sim/map/tile-map';
import { RideType } from '../src/sim/rides/ride-types';
import { serialize } from '../src/save/save';
import { project } from '../src/render/projection';
import { startStarterPark, tileScreenPoint, toolbarTool } from './footpath-helpers';

const proofDir = process.env.TRACK_HEIGHTS_PROOF_DIR;
const GROUND = 4;
const START = { x: 20, y: 20 };

function flatPark(): World {
  const world = new World({ seed: 5, width: 48, height: 48 });
  world.map.fillFlat(GROUND);
  world.map.waterLevel.fill(0);
  world.map.ownership.fill(OWNED);
  world.research.unlocked.add(RideType.SteelLoopingCoaster);
  world.economy.cash = 5_000_000;
  return world;
}

async function centreOn(page: Page, world: World, x: number, y: number): Promise<void> {
  const out = new Float64Array(2);
  const rotation = await page.evaluate(
    () => (window as unknown as { __camera: { rotation: 0 | 1 | 2 | 3 } }).__camera.rotation,
  );
  project(
    x * TILE_UNITS,
    y * TILE_UNITS,
    GROUND * Z_STEP,
    world.map.width,
    world.map.height,
    rotation,
    out,
  );
  await page.evaluate(
    ([cx, cy]) => {
      const camera = (window as unknown as { __camera: { x: number; y: number; zoom: number } })
        .__camera;
      camera.x = cx;
      camera.y = cy;
      camera.zoom = 1;
    },
    [out[0]!, out[1]!] as const,
  );
}

async function build(construction: Locator, turn: string, slope: string): Promise<void> {
  await construction.getByRole('button', { name: turn, exact: true }).click();
  await construction.getByRole('button', { name: slope, exact: true }).click();
  await construction.getByRole('button', { name: 'Build piece' }).click();
}

test('the builder closes a circuit whose ends sit one land level apart', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const world = flatPark();
  const savePath = testInfo.outputPath('flat-park.park');
  await writeFile(savePath, serialize(world));

  await startStarterPark(page);
  await toolbarTool(page, 'Save / Load');
  await page.getByRole('button', { name: 'Import save file' }).click();
  await page.locator('.save-menu input[type="file"]').setInputFiles(savePath);
  await expect(page.locator('.hud')).toContainText('tick');
  await centreOn(page, world, START.x + 2, START.y + 2);

  await toolbarTool(page, 'New ride');
  await page.getByRole('tab', { name: 'Roller Coasters' }).click();
  await page.getByRole('button', { name: /^Steel Looping Coaster/ }).click();
  const [sx, sy] = await tileScreenPoint(page, world, START);
  await page.mouse.click(sx, sy);

  const construction = page.locator('[data-panel="construction"]');
  await expect(construction).toBeVisible();
  await construction.getByLabel('Special elements').selectOption({ label: 'Station' });
  await page.mouse.move(sx, sy);
  await construction.getByRole('button', { name: 'Level', exact: true }).click();
  await construction.getByRole('button', { name: 'Build piece' }).click();
  const info = page.locator('.coaster-info');
  await expect(info).toContainText('Track 1 pieces');
  await expect(construction.locator('.coaster-height')).toHaveText(`Track end at height ${GROUND}`);

  await build(construction, 'Straight', 'Up');
  await expect(construction.locator('.coaster-height')).toHaveText(
    `Track end at height ${GROUND + 0.5}`,
  );
  await build(construction, 'Straight', 'Level');
  await expect(construction.locator('.coaster-height')).toHaveText(
    `Track end at height ${GROUND + 1}`,
  );
  await build(construction, 'Right small', 'Level');
  await build(construction, 'Right small', 'Level');
  await build(construction, 'Straight', 'Level');
  await expect(info).toContainText('open');
  await build(construction, 'Straight', 'Down');
  await build(construction, 'Straight', 'Level');
  await expect(construction.locator('.coaster-height')).toHaveText(`Track end at height ${GROUND}`);
  await build(construction, 'Right small', 'Level');
  await build(construction, 'Right small', 'Level');
  await expect(info).toContainText('Track 10 pieces, closed circuit');

  if (proofDir) {
    mkdirSync(proofDir, { recursive: true });
    for (let rotation = 0; rotation < 4; rotation++) {
      await page.evaluate(
        (r) => ((window as unknown as { __camera: { rotation: number } }).__camera.rotation = r),
        rotation,
      );
      await centreOn(page, world, START.x + 2, START.y + 2);
      await page.waitForTimeout(500);
      await page
        .locator('#game')
        .screenshot({ path: `${proofDir}/closed-circuit-r${rotation}.png` });
    }
  }
});
