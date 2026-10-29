import { copyFile } from 'node:fs/promises';
import { expect, test } from './support/test';
import { centerMapOnTile, toolbarAction } from './support/footprints';
import { RidePhase, RideState } from '../src/sim/rides/ride-store';
import {
  BASELINE,
  PROOF_DIR,
  SHORT,
  buildSite,
  captureFrames,
  encodeFrames,
  installOverlay,
  rideRow,
  rideWindow,
  save,
  startSampler,
  startSite,
  takeSamples,
} from './support/tower';

/**
 * Measures the Observation Tower of the pre-change build (run with TOWER_BASELINE=1 from a checkout
 * of the previous main, where the supporting modules are stubbed): the fixed-height tower is built
 * through the same controls, tested, opened with guests, and timed for one complete cycle at 1x.
 */
test.skip(!PROOF_DIR || !BASELINE, 'set TOWER_PROOF_DIR and TOWER_BASELINE=1');
test.use({ actionTimeout: 60_000, viewport: { width: 960, height: 600 } });

test('the previous tower at 1x: phases and recorded video', async ({ page }, testInfo) => {
  test.setTimeout(1_800_000);
  const plan = { ...SHORT, x: 21 };
  await startSite(page, testInfo, [plan]);
  const [id] = await buildSite(page, [plan]);
  await page.keyboard.press('Shift+Backspace');
  await centerMapOnTile(page, [21, 43]);
  await page.evaluate(() => {
    (window as unknown as { __camera: { y: number } }).__camera.y -= 110;
  });
  await startSampler(page);
  await installOverlay(page, [id]);
  const capture = await captureFrames(page, testInfo.outputPath('frames'));
  const panel = await rideWindow(page, id);
  await panel.getByRole('button', { name: 'Test', exact: true }).click();
  await page.keyboard.press('Shift+Backspace');
  await expect
    .poll(async () => (await rideRow(page, id)).state, { timeout: 300_000, intervals: [1000] })
    .toBe(RideState.Closed);
  const again = await rideWindow(page, id);
  await again.getByRole('button', { name: 'Open', exact: true }).click();
  await toolbarAction(page, 'Game options');
  await page.getByRole('button', { name: 'Guests +1,000' }).click();
  await page.getByRole('button', { name: 'Close Options' }).click();
  await page.keyboard.press('Shift+Backspace');
  const phases = async () => {
    const samples = await takeSamples(page);
    const runs: Array<{ phase: number; start: number; end: number }> = [];
    for (const sample of samples) {
      const ride = sample.rides.find((row) => row[0] === id);
      if (!ride) continue;
      const last = runs.at(-1);
      if (last && last.phase === ride[1]) last.end = sample.tick;
      else runs.push({ phase: ride[1], start: sample.tick, end: sample.tick });
    }
    return runs;
  };
  await expect
    .poll(
      async () => {
        const runs = await phases();
        return runs.some(
          (run, i) =>
            run.phase === RidePhase.Loading &&
            runs[i + 1]?.phase === RidePhase.Running &&
            runs[i + 2]?.phase === RidePhase.Unloading &&
            runs[i + 3] !== undefined,
        );
      },
      { timeout: 900_000, intervals: [5000] },
    )
    .toBe(true);
  const frames = await capture.stop();
  const runs = await phases();
  const i = runs.findIndex(
    (run, k) =>
      run.phase === RidePhase.Loading &&
      runs[k + 1]?.phase === RidePhase.Running &&
      runs[k + 2]?.phase === RidePhase.Unloading &&
      runs[k + 3] !== undefined,
  );
  const timing = {
    name: 'previous fixed-height tower',
    loadTicks: runs[i + 1].start - runs[i].start,
    runTicks: runs[i + 2].start - runs[i + 1].start,
    unloadTicks: runs[i + 3].start - runs[i + 2].start,
  };
  await save(testInfo, 'before-timing.json', JSON.stringify(timing, null, 2));
  const video = testInfo.outputPath('before-cycle-1x.webm');
  await encodeFrames(frames, video);
  if (PROOF_DIR) await copyFile(video, `${PROOF_DIR}/before-cycle-1x.webm`);
});
