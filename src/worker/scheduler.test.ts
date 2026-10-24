import { describe, expect, it } from 'vitest';
import { FixedStepScheduler } from './scheduler';

describe('FixedStepScheduler', () => {
  it('runs 40 ticks over one second', () => {
    const s = new FixedStepScheduler(1000);
    let total = s.advance(0);
    for (let t = 10; t <= 1000; t += 10) total += s.advance(t);
    expect(total).toBe(40);
  });

  it('caps catch-up and counts dropped ticks', () => {
    const s = new FixedStepScheduler(8);
    s.advance(0);
    expect(s.advance(10_000)).toBe(8);
    expect(s.droppedTicks).toBeGreaterThan(0);
  });

  it('runs nothing while paused and does not bank time', () => {
    const s = new FixedStepScheduler(100);
    s.advance(0);
    s.paused = true;
    expect(s.advance(1000)).toBe(0);
    s.paused = false;
    expect(s.advance(1010)).toBeLessThanOrEqual(1);
  });

  it('scales with speed', () => {
    const s = new FixedStepScheduler(1000);
    s.speed = 2;
    s.advance(0);
    expect(s.advance(1000)).toBe(80);
  });
});
