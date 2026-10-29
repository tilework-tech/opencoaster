import { expect, test } from './support/test';
import { RidePhase, RideState } from '../src/sim/rides/ride-store';
import {
  MAX_TOWER_HEIGHT,
  MIN_TOWER_HEIGHT,
  TOWER_TRAVEL_TICKS_PER_LEVEL,
  observationTowerRunTicks,
} from '../src/sim/rides/observation-tower';
import {
  SHORT,
  MEDIUM,
  TALL,
  TICKS_PER_SECOND,
  TOWER_BASE_COST,
  buildSite,
  expectNoPageErrors,
  parkCash,
  rideRow,
  rideRows,
  rideWindow,
  save,
  startSampler,
  startSite,
  takeSamples,
} from './support/tower';
import { observationTowerCost } from '../src/sim/rides/observation-tower';

test.describe('Observation Tower height', () => {
  test.setTimeout(900_000);

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus)
      await save(
        testInfo,
        `failure-${testInfo.title.replace(/\W+/g, '-')}.png`,
        await page.screenshot(),
      );
  });

  test('builds towers of chosen heights through the build controls, charging section prices', async ({
    page,
  }, testInfo) => {
    const plans = [SHORT, MEDIUM, TALL];
    await startSite(page, testInfo, plans);
    const before = await parkCash(page);
    const ids = await buildSite(page, plans);
    expect(new Set(ids).size).toBe(plans.length);

    const rows = await rideRows(page);
    let spent = 0;
    for (const [index, plan] of plans.entries()) {
      const row = rows.find((candidate) => candidate.id === ids[index])!;
      expect(row.towerHeight).toBe(plan.height);
      expect(row.state).toBe(RideState.Closed);
      spent += observationTowerCost(TOWER_BASE_COST, plan.height);
    }
    expect(before - (await parkCash(page))).toBeGreaterThanOrEqual(spent);
    expectNoPageErrors(page);
    await save(testInfo, 'built-short-medium-tall.png', await page.screenshot());
  });

  test('edits the height of a closed tower and locks the controls once it is open', async ({
    page,
  }, testInfo) => {
    await startSite(page, testInfo, [SHORT]);
    const [id] = await buildSite(page, [SHORT]);
    const panel = await rideWindow(page, id);
    const add = panel.getByRole('button', { name: 'Add one tower section' });
    const remove = panel.getByRole('button', { name: 'Remove one tower section' });
    await expect(panel).toContainText(
      `${MIN_TOWER_HEIGHT} levels (${MIN_TOWER_HEIGHT}–${MAX_TOWER_HEIGHT})`,
      { timeout: 30_000 },
    );
    await expect(remove).toBeDisabled();

    const cashBefore = await parkCash(page);
    for (let step = 0; step < 3; step++) await add.click();
    await expect.poll(async () => (await rideRow(page, id)).towerHeight).toBe(MIN_TOWER_HEIGHT + 3);
    await expect(panel).toContainText(`${MIN_TOWER_HEIGHT + 3} levels`);
    expect(await parkCash(page)).toBeLessThan(cashBefore);
    await remove.click();
    await expect.poll(async () => (await rideRow(page, id)).towerHeight).toBe(MIN_TOWER_HEIGHT + 2);
    await save(testInfo, 'height-edit.png', await page.screenshot());

    await panel.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(add).toBeDisabled();
    await expect(remove).toBeDisabled();
    await expect(panel).toContainText('Close the ride to change its height.');
    expectNoPageErrors(page);
  });

  test('moves the cabin up once, holds, and down once at the distance-based speed', async ({
    page,
  }, testInfo) => {
    await startSite(page, testInfo, [SHORT]);
    const [id] = await buildSite(page, [SHORT]);
    const panel = await rideWindow(page, id);
    await startSampler(page);
    await panel.getByRole('button', { name: 'Test', exact: true }).click();
    await expect
      .poll(async () => (await rideRow(page, id)).phase, { timeout: 30_000 })
      .toBe(RidePhase.Running);
    await expect
      .poll(async () => (await rideRow(page, id)).phase, { timeout: 240_000, intervals: [1000] })
      .not.toBe(RidePhase.Running);

    const samples = await takeSamples(page);
    await save(testInfo, 'tower-test-run-samples.json', JSON.stringify(samples));
    const series = samples
      .map((sample) => ({
        t: sample.t,
        tick: sample.tick,
        ride: sample.rides.find((row) => row[0] === id),
      }))
      .filter(
        (sample): sample is { t: number; tick: number; ride: number[] } =>
          sample.ride !== undefined,
      );
    const largestGap = Math.max(
      ...series.slice(1).map((sample, i) => sample.tick - series[i].tick),
    );
    const running = series.filter((sample) => sample.ride[1] === RidePhase.Running);
    expect(running.length).toBeGreaterThan(5);
    expect(
      Math.abs(running.at(-1)!.tick - running[0].tick - observationTowerRunTicks(SHORT.height)),
    ).toBeLessThanOrEqual(2 * largestGap + 2);
    let reversals = 0;
    let direction = 0;
    for (let i = 1; i < running.length; i++) {
      const elapsed = running[i].tick - running[i - 1].tick;
      const delta = (running[i].ride[2] - running[i - 1].ride[2]) / 1000;
      if (elapsed <= 0) continue;
      expect(Math.abs(delta / elapsed)).toBeLessThanOrEqual(
        1 / TOWER_TRAVEL_TICKS_PER_LEVEL + 0.002,
      );
      const sign = Math.sign(delta);
      if (sign !== 0 && direction !== 0 && sign !== direction) reversals++;
      if (sign !== 0) direction = sign;
    }
    expect(reversals).toBe(1);
    const wall = (series.at(-1)!.t - series[0].t) / 1000;
    const ticks = series.at(-1)!.tick - series[0].tick;
    expect(ticks / wall).toBeLessThanOrEqual(TICKS_PER_SECOND * 1.1);
    expectNoPageErrors(page);
  });
});
