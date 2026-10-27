import { describe, expect, it } from 'vitest';
import { AdaptiveResolution } from './adaptive-resolution';

/** Feeds frames whose duration is `frameMsAt(scale)` for the given number of seconds. */
function run(
  controller: AdaptiveResolution,
  frameMsAt: (scale: number) => number,
  seconds: number,
): void {
  let elapsed = 0;
  while (elapsed < seconds * 1000) {
    const frameMs = frameMsAt(controller.scale);
    controller.record(frameMs);
    elapsed += frameMs;
  }
}

/** Frame cost that falls with resolution, like a fill-rate-bound GPU. */
const fillBound = (scale: number): number => Math.max(16.7, 50 * scale * scale);

describe('AdaptiveResolution', () => {
  it('stays at full resolution while frames meet the budget', () => {
    const controller = new AdaptiveResolution();
    run(controller, () => 16.7, 30);
    expect(controller.scale).toBe(1);
  });

  it('lowers resolution when frames are slow and a lower resolution is faster', () => {
    const controller = new AdaptiveResolution();
    run(controller, fillBound, 6);
    expect(controller.scale).toBeLessThan(1);
  });

  it('ignores a brief hitch', () => {
    const controller = new AdaptiveResolution();
    run(controller, () => 16.7, 5);
    controller.record(400);
    run(controller, () => 16.7, 5);
    expect(controller.scale).toBe(1);
  });

  it('never drops below its minimum scale', () => {
    const controller = new AdaptiveResolution({ minScale: 0.5 });
    run(controller, (scale) => 80 * scale * scale, 120);
    expect(controller.scale).toBe(0.5);
  });

  it('keeps at least one backing pixel per game pixel at the current DPR and zoom', () => {
    for (const [dpr, zoom] of [
      [1, 0.5],
      [2, 1],
      [2, 2],
      [1, 4],
    ]) {
      const controller = new AdaptiveResolution();
      controller.setPixelPolicy(dpr!, zoom!, false);
      run(controller, () => 16.7, 2);
      run(controller, (scale) => 100 * scale * scale, 6);
      expect(dpr! * Math.max(1, zoom!) * controller.scale).toBeGreaterThanOrEqual(1);
    }
  });

  it('allows a lower pixel density only when the caller opts in', () => {
    const controller = new AdaptiveResolution();
    controller.setPixelPolicy(2, 1, true);
    run(controller, () => 16.7, 2);
    run(controller, (scale) => 100 * scale * scale, 6);
    expect(controller.scale).toBe(0.3);
  });

  it('restores resolution after frames recover for long enough', () => {
    const controller = new AdaptiveResolution();
    run(controller, fillBound, 6);
    expect(controller.scale).toBeLessThan(1);
    run(controller, () => 16.7, 120);
    expect(controller.scale).toBe(1);
  });

  it('backs off retrying a resolution that was too slow', () => {
    const controller = new AdaptiveResolution();
    run(controller, fillBound, 6);
    const lowered = controller.scale;
    let raises = 0;
    let previous = lowered;
    for (let i = 0; i < 6000; i++) {
      controller.record(controller.scale > lowered ? 50 : 16.7);
      if (controller.scale > previous) raises++;
      previous = controller.scale;
    }
    expect(raises).toBeLessThanOrEqual(3);
  });

  it('does not reduce scale at stable 30–60 Hz refresh cadences', () => {
    for (const refreshInterval of [33.3, 25, 20, 16.7]) {
      const controller = new AdaptiveResolution();
      for (let i = 0; i < 1200; i++) {
        controller.record(refreshInterval);
        expect(controller.scale).toBe(1);
      }
    }
  });

  it('detects overload above the observed refresh budget', () => {
    const controller = new AdaptiveResolution();
    run(controller, () => 33.3, 3);
    let lowestScale = controller.scale;
    for (let i = 0; i < 100; i++) {
      controller.record(50);
      lowestScale = Math.min(lowestScale, controller.scale);
    }
    expect(lowestScale).toBeLessThan(1);
  });

  it('raises the scale to the crisp-pixel floor when the opt-in is turned off', () => {
    const controller = new AdaptiveResolution();
    controller.setPixelPolicy(2, 1, true);
    run(controller, () => 16.7, 2);
    run(controller, (scale) => 100 * scale * scale, 6);
    expect(controller.scale).toBe(0.3);
    controller.setPixelPolicy(2, 1, false);
    expect(2 * controller.scale).toBeGreaterThanOrEqual(1);
  });
});
