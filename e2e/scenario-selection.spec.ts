import { expect, test } from './support/test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const TABS = [
  ['Beginner Parks', 'beginner', 'Difficulty: Beginner'],
  ['Challenging Parks', 'challenging', 'Difficulty: Challenging'],
  ['Expert Parks', 'expert', 'Difficulty: Expert'],
  ['Real Parks', 'real', 'Category: Real'],
  ['Other Parks', 'other', 'Category: Other'],
] as const;
const SCENARIOS = readdirSync(resolve(process.cwd(), 'src/sim/scenario/scenarios'))
  .filter((file) => file.endsWith('.json'))
  .map(
    (file) =>
      JSON.parse(
        readFileSync(resolve(process.cwd(), 'src/sim/scenario/scenarios', file), 'utf8'),
      ) as {
        id: string;
        name: string;
        category?: string;
        map: { width: number; height: number };
        objective: { kind: string };
      },
  );

test('scenario selection lists every tab and remembers completed parks', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();

  for (const [tab, category, categoryText] of TABS) {
    await page.getByRole('tab', { name: tab }).click();
    await expect(page.locator('.scenario-card').first()).toBeVisible();
    await expect(page.locator('.scenario-preview-panel .scenario-objective')).toContainText(
      'Objective',
    );
    const cards = page.locator('.scenario-card');
    const scenarios = SCENARIOS.filter(
      (scenario) => (scenario.category ?? 'beginner') === category,
    );
    await expect(cards).toHaveCount(scenarios.length);
    for (const scenario of scenarios) {
      const card = cards.filter({
        has: page.getByRole('button', { name: scenario.name, exact: true }),
      });
      await expect(
        card.getByRole('img', { name: `${scenario.name} scenario preview` }),
      ).toBeVisible();
      await expect(
        card.getByRole('img', { name: `${scenario.name} scenario preview` }),
      ).toHaveJSProperty('naturalWidth', scenario.map.width);
      await expect(card.locator('.scenario-objective')).toContainText('Objective:');
      await expect(card.locator('.scenario-objective')).toContainText(
        scenario.objective.kind === 'haveFun' ? 'No deadline.' : 'Deadline:',
      );
      await expect(card.locator('.scenario-rank')).toHaveText(categoryText);
      await expect(card.locator('.scenario-map-size')).toHaveText(
        `Map size: ${scenario.map.width} × ${scenario.map.height} tiles`,
      );
    }
  }
  await expect(page.getByRole('tab', { name: 'Beginner Parks' })).toContainText('(0/');

  await page.evaluate(() => {
    localStorage.setItem(
      'opencoaster.scenarioProgress.v1',
      JSON.stringify({ meadowbrook: { completedAt: 1_700_000_000_000 } }),
    );
  });
  await page.reload();
  await page.getByRole('button', { name: 'New game' }).click();
  await expect(page.getByRole('tab', { name: 'Beginner Parks' })).toContainText('(1/');
  const card = page.locator('.scenario-card').filter({ hasText: 'Meadowbrook Green' });
  await expect(card).toHaveClass(/completed/);
  await expect(card).toContainText('Completed');
  await card.getByRole('button', { name: 'Meadowbrook Green' }).click();
  await expect(page.locator('.scenario-preview-panel .scenario-status')).toContainText('Completed');

  await card.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.title-screen')).toBeHidden();
});
