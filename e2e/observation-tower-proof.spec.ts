import { copyFile, mkdir } from 'node:fs/promises';
import { devices, expect, test } from './support/test';
import type { Page, TestInfo } from './support/test';
import { chooseRide, startStarterPark, toolbarAction, unlockRides } from './support/footprints';
import { RideType } from '../src/sim/rides/ride-types';
import { RidePhase, RideState } from '../src/sim/rides/ride-store';
import {
  DEFAULT_TOWER_HEIGHT,
  TOWER_LOAD_TICKS,
  TOWER_UNLOAD_TICKS,
  observationTowerRunTicks,
} from '../src/sim/rides/observation-tower';
import { centerMapOnTile } from './support/footprints';
import { createTestContext } from './support/test-contexts';
import {
  MEDIUM,
  PROOF_DIR,
  SHORT,
  TALL,
  TICKS_PER_SECOND,
  buildSite,
  expectNoPageErrors,
  rideRow,
  rideWindow,
  save,
  startSampler,
  startSite,
  takeSamples,
} from './support/tower';
import type { Sample } from './support/tower';

/**
 * Captures the pull request's browser proof: short, medium and tall towers built through the build
 * controls, tested and opened with guests at 1x, photographed in every view rotation, and timed.
 * Runs only when TOWER_PROOF_DIR names the output directory.
 */
test.skip(!PROOF_DIR, 'set TOWER_PROOF_DIR to capture the proof');

test.use({ video: { mode: 'on', size: { width: 1280, height: 800 } } });

const PLANS = [SHORT, MEDIUM, TALL];

interface PhaseRun {
  phase: number;
  startTick: number;
  endTick: number;
}

interface RideTiming {
  id: number;
  name: string;
  height: number;
  expectedRunTicks: number;
  cycles: Array<{
    loadTicks: number;
    runTicks: number;
    unloadTicks: number;
    runSecondsAt1x: number;
    maxLevelPerTick: number;
    reversals: number;
    peakLevel: number;
  }>;
}

const PHASE_NAMES: Record<number, string> = {
  [RidePhase.Closed]: 'closed',
  [RidePhase.Waiting]: 'waiting',
  [RidePhase.Loading]: 'loading',
  [RidePhase.Running]: 'running',
  [RidePhase.Unloading]: 'unloading',
  [RidePhase.Broken]: 'broken',
};

function phaseRuns(samples: Sample[], id: number): PhaseRun[] {
  const runs: PhaseRun[] = [];
  for (const sample of samples) {
    const ride = sample.rides.find((row) => row[0] === id);
    if (!ride) continue;
    const last = runs.at(-1);
    if (last && last.phase === ride[1]) last.endTick = sample.tick;
    else runs.push({ phase: ride[1], startTick: sample.tick, endTick: sample.tick });
  }
  return runs;
}

/** Complete load, run, unload cycles, with the cabin's speed and turnarounds in each run. */
function timingFor(samples: Sample[], id: number, name: string, height: number): RideTiming {
  const runs = phaseRuns(samples, id);
  const cycles: RideTiming['cycles'] = [];
  for (let i = 0; i + 2 < runs.length; i++) {
    if (
      runs[i].phase !== RidePhase.Loading ||
      runs[i + 1].phase !== RidePhase.Running ||
      runs[i + 2].phase !== RidePhase.Unloading
    )
      continue;
    const running = samples.filter((sample) => {
      const ride = sample.rides.find((row) => row[0] === id);
      return (
        ride !== undefined &&
        ride[1] === RidePhase.Running &&
        sample.tick >= runs[i + 1].startTick &&
        sample.tick <= runs[i + 1].endTick
      );
    });
    let maxLevelPerTick = 0;
    let reversals = 0;
    let direction = 0;
    let peakLevel = 0;
    for (let k = 1; k < running.length; k++) {
      const a = running[k - 1].rides.find((row) => row[0] === id)!;
      const b = running[k].rides.find((row) => row[0] === id)!;
      const elapsed = running[k].tick - running[k - 1].tick;
      if (elapsed <= 0) continue;
      const delta = (b[2] - a[2]) / 1000;
      maxLevelPerTick = Math.max(maxLevelPerTick, Math.abs(delta) / elapsed);
      peakLevel = Math.max(peakLevel, b[2] / 1000);
      const sign = Math.sign(delta);
      if (sign !== 0 && direction !== 0 && sign !== direction) reversals++;
      if (sign !== 0) direction = sign;
    }
    const loadTicks = runs[i + 1].startTick - runs[i].startTick;
    const runTicks = runs[i + 2].startTick - runs[i + 1].startTick;
    const unloadTicks = (runs[i + 3]?.startTick ?? runs[i + 2].endTick) - runs[i + 2].startTick;
    cycles.push({
      loadTicks,
      runTicks,
      unloadTicks,
      runSecondsAt1x: runTicks / TICKS_PER_SECOND,
      maxLevelPerTick,
      reversals,
      peakLevel,
    });
  }
  return { id, name, height, expectedRunTicks: observationTowerRunTicks(height), cycles };
}

async function mark(page: Page, label: string): Promise<void> {
  await page.evaluate((text) => {
    const w = window as unknown as {
      __sim: { latest: { tick: number } };
      __marks?: Array<{ label: string; t: number; tick: number }>;
    };
    (w.__marks ??= []).push({ label: text, t: performance.now(), tick: w.__sim.latest.tick });
  }, label);
}

async function marks(page: Page): Promise<Array<{ label: string; t: number; tick: number }>> {
  return page.evaluate(
    () =>
      (window as unknown as { __marks?: Array<{ label: string; t: number; tick: number }> })
        .__marks ?? [],
  );
}

async function zoomOutToFit(page: Page): Promise<void> {
  for (let step = 0; step < 4; step++) {
    const zoom = await page.evaluate(
      () => (window as unknown as { __camera: { zoom: number } }).__camera.zoom,
    );
    if (zoom <= 0.55) return;
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(400);
  }
}

async function closeWindows(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+Backspace');
  await page.mouse.move(640, 20);
}

async function rotate(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
}

async function viewRotation(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __camera: { rotation: number } }).__camera.rotation,
  );
}

/** One screenshot per view rotation, ending where it started. */
async function shootRotations(page: Page, testInfo: TestInfo, prefix: string): Promise<void> {
  for (let turn = 0; turn < 4; turn++) {
    const rotation = await viewRotation(page);
    await save(testInfo, `${prefix}-rotation-${rotation}.png`, await page.screenshot());
    await rotate(page);
  }
}

async function copyVideo(page: Page, name: string): Promise<void> {
  const video = page.video();
  if (!video || !PROOF_DIR) return;
  await page.close();
  await mkdir(PROOF_DIR, { recursive: true });
  await copyFile(await video.path(), `${PROOF_DIR}/${name}`);
}

async function testRun(page: Page, ids: readonly number[]): Promise<void> {
  for (const id of ids) {
    const panel = await rideWindow(page, id);
    await panel.getByRole('button', { name: 'Test', exact: true }).click();
  }
}

test.describe('proof: WebGL2 at 1x', () => {
  test.setTimeout(1_800_000);

  test('short, medium and tall towers: test runs, rotations, riders, speeds', async ({
    page,
  }, testInfo) => {
    await startSite(page, testInfo, PLANS);
    const ids = await buildSite(page, PLANS);
    await save(testInfo, 'webgl2-built-closed.png', await page.screenshot());
    await closeWindows(page);
    await centerMapOnTile(page, [21, 43]);
    await zoomOutToFit(page);
    await save(testInfo, 'webgl2-built-zoomed-out.png', await page.screenshot());

    await startSampler(page);
    await testRun(page, ids);
    await closeWindows(page);
    await expect
      .poll(async () => (await rideRow(page, ids[2])).cabinMilli, { timeout: 120_000 })
      .toBeGreaterThan(10_000);
    await shootRotations(page, testInfo, 'webgl2-test-run-cabin-ascending');
    await expect
      .poll(async () => (await rideRow(page, ids[2])).cabinMilli, {
        timeout: 240_000,
        intervals: [500],
      })
      .toBeGreaterThan((TALL.height - 5) * 1000);
    await save(testInfo, 'webgl2-test-run-cabin-at-top.png', await page.screenshot());
    for (const id of ids)
      await expect
        .poll(async () => (await rideRow(page, id)).state, { timeout: 300_000, intervals: [1000] })
        .toBe(RideState.Closed);
    await expect
      .poll(async () => (await rideRow(page, ids[2])).phase, {
        timeout: 300_000,
        intervals: [1000],
      })
      .toBe(RidePhase.Closed);

    for (const id of ids) {
      const panel = await rideWindow(page, id);
      await panel.getByRole('button', { name: 'Open', exact: true }).click();
      await expect.poll(async () => (await rideRow(page, id)).state).toBe(RideState.Open);
    }
    await toolbarAction(page, 'Game options');
    await page.getByRole('button', { name: 'Guests +1,000' }).click();
    await page.getByRole('button', { name: 'Close Options' }).click();
    await closeWindows(page);

    // Wait until the tall tower is in the middle of a dispatched trip, then probe the speeds.
    await expect
      .poll(
        async () => {
          const row = await rideRow(page, ids[2]);
          return row.phase === RidePhase.Running && row.cabinMilli > 8_000;
        },
        { timeout: 900_000, intervals: [1000] },
      )
      .toBe(true);
    await save(testInfo, 'webgl2-riders-cabin-aloft.png', await page.screenshot());
    const speeds: Array<[string, () => Promise<void>]> = [
      ['1x', async () => undefined],
      [
        '2x',
        async () =>
          page.locator('.game-toolbar').getByRole('button', { name: 'Game speed 2×' }).click(),
      ],
      [
        '4x',
        async () =>
          page.locator('.game-toolbar').getByRole('button', { name: 'Game speed 4×' }).click(),
      ],
      [
        'paused',
        async () =>
          page.locator('.game-toolbar').getByRole('button', { name: 'Pause', exact: true }).click(),
      ],
      [
        'resumed-1x',
        async () => {
          await page
            .locator('.game-toolbar')
            .getByRole('button', { name: 'Resume', exact: true })
            .click();
          await page
            .locator('.game-toolbar')
            .getByRole('button', { name: 'Game speed 1×' })
            .click();
        },
      ],
    ];
    for (const [label, apply] of speeds) {
      await apply();
      await mark(page, `${label}-start`);
      await page.waitForTimeout(4000);
      await mark(page, `${label}-end`);
    }

    // Let every tower finish at least one full operating cycle with riders.
    await expect
      .poll(
        async () => {
          const samples = await takeSamples(page);
          return ids.every((id) => timingFor(samples, id, '', 0).cycles.length > 0);
        },
        { timeout: 1_200_000, intervals: [5000] },
      )
      .toBe(true);

    const samples = await takeSamples(page);
    const timings = ids.map((id, index) =>
      timingFor(samples, id, PLANS[index].name, PLANS[index].height),
    );
    const allMarks = await marks(page);
    const speedProbe = ['1x', '2x', '4x', 'paused', 'resumed-1x'].map((label) => {
      const start = allMarks.find((m) => m.label === `${label}-start`)!;
      const end = allMarks.find((m) => m.label === `${label}-end`)!;
      const seconds = (end.t - start.t) / 1000;
      return {
        label,
        ticks: end.tick - start.tick,
        wallSeconds: seconds,
        ticksPerSecond: (end.tick - start.tick) / seconds,
      };
    });
    await save(
      testInfo,
      'webgl2-timing-summary.json',
      JSON.stringify(
        {
          renderer: 'webgl2',
          ticksPerSecondAt1x: TICKS_PER_SECOND,
          loadTicks: TOWER_LOAD_TICKS,
          unloadTicks: TOWER_UNLOAD_TICKS,
          timings,
          speedProbe,
          phaseNames: PHASE_NAMES,
        },
        null,
        2,
      ),
    );
    await save(testInfo, 'webgl2-samples.json', JSON.stringify(samples));
    expectNoPageErrors(page);
    await copyVideo(page, 'webgl2-after-1x.webm');
  });
});

test.describe('proof: Canvas2D', () => {
  test.setTimeout(1_200_000);

  test('towers render and animate with the Canvas2D fallback', async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
        if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
        return originalGetContext.call(this, type as '2d', ...(args as []));
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
    await startSite(page, testInfo, PLANS);
    await expect(page.locator('.hud')).toContainText('Canvas2D');
    const ids = await buildSite(page, PLANS);
    await closeWindows(page);
    await centerMapOnTile(page, [21, 43]);
    await zoomOutToFit(page);
    await save(testInfo, 'canvas2d-built-zoomed-out.png', await page.screenshot());
    await testRun(page, ids);
    await closeWindows(page);
    await expect
      .poll(async () => (await rideRow(page, ids[2])).cabinMilli, { timeout: 180_000 })
      .toBeGreaterThan(10_000);
    await shootRotations(page, testInfo, 'canvas2d-test-run-cabin-ascending');
    await expect
      .poll(async () => (await rideRow(page, ids[2])).cabinMilli, {
        timeout: 240_000,
        intervals: [500],
      })
      .toBeGreaterThan((TALL.height - 5) * 1000);
    await save(testInfo, 'canvas2d-test-run-cabin-at-top.png', await page.screenshot());
    expectNoPageErrors(page);
    await copyVideo(page, 'canvas2d-test-run.webm');
  });
});

test.describe('proof: phone controls', () => {
  test.setTimeout(600_000);

  test('the height controls are usable on a phone', async ({ browser }, testInfo) => {
    const { defaultBrowserType: _browserType, ...options } = devices['Pixel 8'];
    void _browserType;
    const context = await createTestContext(browser, { ...options, serviceWorkers: 'allow' });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await startStarterPark(page, true);
    await unlockRides(page, testInfo, [RideType.ObservationTower], true);
    await chooseRide(page, 'Gentle rides', RideType.ObservationTower, true);
    const control = page.locator('.tower-height-control');
    await expect(control).toBeVisible({ timeout: 30_000 });
    for (const name of ['Raise tower by one section', 'Lower tower by one section']) {
      const button = control.getByRole('button', { name });
      const box = (await button.boundingBox())!;
      expect(box.width, name).toBeGreaterThanOrEqual(40);
      expect(box.height, name).toBeGreaterThanOrEqual(40);
    }
    for (let step = 0; step < 6; step++)
      await control.getByRole('button', { name: 'Raise tower by one section' }).tap();
    await expect(control).toContainText(`${DEFAULT_TOWER_HEIGHT + 6} levels`);
    for (const selector of ['.game-toolbar', '.tool-status', '.objective-strip', '.hud']) {
      for (const other of await page.locator(selector).all()) {
        if (!(await other.isVisible())) continue;
        const a = (await control.boundingBox())!;
        const b = (await other.boundingBox())!;
        const overlap =
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height;
        expect(overlap, `height control overlaps ${selector}`).toBe(false);
      }
    }
    await save(testInfo, 'mobile-height-control.png', await page.screenshot());
    await context.close();
  });
});
