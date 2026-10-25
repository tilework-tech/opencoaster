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

  it('keeps full resolution when frames are slow regardless of resolution', () => {
    // A display capped at 30 Hz produces ~33 ms frames at any scale; blurring the image cannot help.
    const controller = new AdaptiveResolution();
    run(controller, () => 33.3, 40);
    expect(controller.scale).toBe(1);
  });
});
