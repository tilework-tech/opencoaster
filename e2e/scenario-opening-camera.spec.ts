import { expect, test } from './support/test';
import { readdirSync, readFileSync } from 'node:fs';
import { TILE_UNITS, Z_STEP } from '../src/sim/core/constants';
import { World } from '../src/sim/core/world';
import { parseScenarioFile } from '../src/sim/scenario/scenario-file';
import { prepareScenario } from '../src/sim/scenario/scenario-layout';
import { project } from '../src/render/projection';

const scenarioDirectory = new URL('../src/sim/scenario/scenarios/', import.meta.url);
const scenarios = readdirSync(scenarioDirectory)
  .filter((file) => file.endsWith('.json'))
  .map((file) =>
    parseScenarioFile(JSON.parse(readFileSync(new URL(file, scenarioDirectory), 'utf8'))),
  );

const categoryLabels: Record<string, string> = {
  beginner: 'Beginner Parks',
  challenging: 'Challenging Parks',
  expert: 'Expert Parks',
  real: 'Real Parks',
  other: 'Other Parks',
};

function expectedOpeningPosition(scenario: (typeof scenarios)[number]): [number, number] {
  if (!scenario.entrance) throw new Error(`${scenario.name} has no configured entrance`);
  const world = new World({
    seed: scenario.seed,
    width: scenario.mapWidth,
    height: scenario.mapHeight,
  });
  prepareScenario(world, scenario);
  const direction = {
    north: [0, 1],
    east: [-1, 0],
    south: [0, -1],
    west: [1, 0],
  }[scenario.entrance.side];
  const pathCentre = (scenario.entrance.length - 1) / 2;
  const target = new Float64Array(2);
  const entranceIndex = world.map.index(world.park.entranceX, world.park.entranceY);
  project(
    (world.park.entranceX + 0.5 + direction[0] * pathCentre) * TILE_UNITS,
    (world.park.entranceY + 0.5 + direction[1] * pathCentre) * TILE_UNITS,
    world.map.heights[entranceIndex]! * Z_STEP,
    scenario.mapWidth,
    scenario.mapHeight,
    0,
    target,
  );
  return [target[0]!, target[1]!];
}

test('every scenario opens centred on its entrance and footpath', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });

  for (const scenario of scenarios) {
    if (!scenario.entrance) throw new Error(`${scenario.name} has no configured entrance`);
    const target = expectedOpeningPosition(scenario);

    await page.goto('/');
    await page.getByRole('button', { name: 'New game' }).click();
    const category = categoryLabels[scenario.category ?? 'beginner'];
    await page.getByRole('tab').filter({ hasText: category }).click();
    const card = page.locator('.scenario-card').filter({ hasText: scenario.name });
    await card.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.locator('.game-toolbar')).toBeVisible();
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const { x, y, rotation } = (
              window as unknown as {
                __camera: { x: number; y: number; rotation: number };
              }
            ).__camera;
            return [x, y, rotation];
          }),
        { message: `${scenario.name} opening camera should frame the entrance path` },
      )
      .toEqual([target[0], target[1], 0]);
  }
});
