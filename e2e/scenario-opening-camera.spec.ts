import { expect, test } from '@playwright/test';
import { TILE_UNITS, Z_STEP } from '../src/sim/core/constants';
import { World } from '../src/sim/core/world';
import { SCENARIOS } from '../src/sim/scenario/catalog';
import { prepareScenario } from '../src/sim/scenario/scenario-layout';
import { project } from '../src/render/projection';

test('opens Starter Park centred on the entrance and its footpath', async ({ page }) => {
  const starter = SCENARIOS.find((scenario) => scenario.id === 'starter');
  if (!starter?.entrance) throw new Error('Starter Park entrance missing');
  const world = new World({
    seed: starter.seed,
    width: starter.mapWidth,
    height: starter.mapHeight,
  });
  prepareScenario(world, starter);
  const direction = { north: [0, 1], east: [-1, 0], south: [0, -1], west: [1, 0] }[
    starter.entrance.side
  ];
  const pathCentre = (starter.entrance.length - 1) / 2;
  const target = new Float64Array(2);
  project(
    (world.park.entranceX + 0.5 + direction[0] * pathCentre) * TILE_UNITS,
    (world.park.entranceY + 0.5 + direction[1] * pathCentre) * TILE_UNITS,
    world.map.heights[world.map.index(world.park.entranceX, world.park.entranceY)]! * Z_STEP,
    starter.mapWidth,
    starter.mapHeight,
    0,
    target,
  );

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  await page
    .locator('.scenario-card')
    .filter({ hasText: 'Starter Park' })
    .getByRole('button', {
      name: 'Start',
      exact: true,
    })
    .click();
  await expect(page.locator('.game-toolbar')).toBeVisible();

  const camera = await page.evaluate(() => {
    const { x, y, rotation } = (
      window as unknown as {
        __camera: { x: number; y: number; rotation: number };
      }
    ).__camera;
    return [x, y, rotation];
  });
  expect(camera).toEqual([target[0], target[1], 0]);
});
