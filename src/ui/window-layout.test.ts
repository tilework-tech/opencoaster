import { describe, expect, it } from 'vitest';
import {
  MOBILE_MAX_WIDTH,
  cascadePosition,
  clampPosition,
  effectiveGameSpeed,
  isMobileWidth,
  positionAwayFromPoint,
} from './window-layout';

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
    expect(far.y + size.height).toBeLessThanOrEqual(800 - 68);
  });

  it('places new windows away from the current pointer when there is room', () => {
    const position = positionAwayFromPoint(
      { x: 640, y: 400 },
      { width: 340, height: 260 },
      { x: 640, y: 400 },
      1280,
      800,
    );

    expect(position.x + 340).toBeLessThanOrEqual(640);
  });

  it('keeps new windows above the desktop status bar', () => {
    const size = { width: 340, height: 260 };
    const position = positionAwayFromPoint({ x: 640, y: 400 }, size, { x: 640, y: 20 }, 1280, 800);

    expect(position.y + size.height).toBeLessThanOrEqual(800 - 68);
  });

  it('clamps the fallback position when no corner clears the pointer', () => {
    const position = positionAwayFromPoint(
      { x: 640, y: 700 },
      { width: 900, height: 700 },
      { x: 640, y: 400 },
      1280,
      800,
    );

    expect(position.y).toBe(40);
  });

  it('chooses another clear corner when a window already occupies the preferred one', () => {
    const size = { width: 340, height: 260 };
    const point = { x: 1180, y: 20 };
    const first = positionAwayFromPoint({ x: 788, y: 162 }, size, point, 1280, 800);
    const second = positionAwayFromPoint({ x: 760, y: 190 }, size, point, 1280, 800, [
      { ...first, ...size },
    ]);

    const overlaps =
      second.x < first.x + size.width &&
      second.x + size.width > first.x &&
      second.y < first.y + size.height &&
      second.y + size.height > first.y;
    expect(overlaps).toBe(false);
  });

  it('finds a free slot between occupied corners before overlapping anything', () => {
    const size = { width: 340, height: 260 };
    const occupied = [
      { x: 16, y: 50, ...size },
      { x: 924, y: 50, ...size },
      { x: 16, y: 462, ...size },
      { x: 924, y: 462, ...size },
    ];
    const at = positionAwayFromPoint(
      { x: 500, y: 100 },
      size,
      { x: 640, y: 20 },
      1280,
      800,
      occupied,
    );

    const overlaps = occupied.some(
      (rect) =>
        at.x < rect.x + rect.width &&
        at.x + size.width > rect.x &&
        at.y < rect.y + rect.height &&
        at.y + size.height > rect.y,
    );
    expect(overlaps).toBe(false);
  });

  it('limits four-times speed to two-times while construction is active', () => {
    expect(effectiveGameSpeed(4, true)).toBe(2);
    expect(effectiveGameSpeed(4, false)).toBe(4);
  });
});
