import { describe, expect, it } from 'vitest';
import { MOBILE_MAX_WIDTH, cascadePosition, clampPosition, isMobileWidth } from './window-layout';

describe('window layout', () => {
  it('treats viewports narrower than 700px as mobile', () => {
    expect(MOBILE_MAX_WIDTH).toBe(699);
    expect(isMobileWidth(699)).toBe(true);
    expect(isMobileWidth(700)).toBe(false);
  });

  it('cascades new windows diagonally and wraps before leaving the viewport', () => {
    const first = cascadePosition(0, 1280, 800);
    const second = cascadePosition(1, 1280, 800);
    expect(second.x).toBeLessThan(first.x);
    expect(second.y).toBeGreaterThan(first.y);
    const far = cascadePosition(500, 1280, 800);
    expect(far.x).toBeLessThan(1280);
    expect(far.y).toBeLessThan(800);
  });

  it('keeps a dragged window title bar reachable', () => {
    const size = { width: 300, height: 200 };
    expect(clampPosition(-900, -50, size, 1280, 800)).toEqual({ x: -260, y: 40 });
    const far = clampPosition(5000, 5000, size, 1280, 800);
    expect(far.x).toBe(1240);
    expect(far.y).toBeLessThanOrEqual(800 - 30);
  });
});
