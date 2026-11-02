import { describe, expect, it } from 'vitest';
import { largestFreeRect, revealShift, type Rect } from './selection-reveal';

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (a: Rect, b: Rect): boolean =>
  a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
const shifted = (piece: Rect, viewport: Rect, covers: Rect[]): Rect => {
  const shift = revealShift(piece, viewport, covers);
  expect(shift).not.toBeNull();
  return { ...piece, x: piece.x + shift!.dx, y: piece.y + shift!.dy };
};
const expectCentredIn = (piece: Rect, area: Rect): void => {
  expect(piece.x + piece.width / 2).toBeCloseTo(area.x + area.width / 2);
  expect(piece.y + piece.height / 2).toBeCloseTo(area.y + area.height / 2);
};

/** Pixel 8 portrait: toolbar, tool status line, bottom sheets and status bar. */
const portrait: Rect = { x: 0, y: 0, width: 412, height: 839 };
const portraitCovers: Rect[] = [
  { x: 0, y: 0, width: 412, height: 52 },
  { x: 6, y: 58, width: 400, height: 28 },
  { x: 0, y: 420, width: 412, height: 319 },
  { x: 0, y: 739, width: 412, height: 100 },
];

/** Landscape phone: floating construction window on the right. */
const landscape: Rect = { x: 0, y: 0, width: 915, height: 412 };
const landscapeCovers: Rect[] = [
  { x: 0, y: 0, width: 915, height: 44 },
  { x: 591, y: 48, width: 320, height: 290 },
  { x: 0, y: 344, width: 915, height: 68 },
];

describe('largestFreeRect', () => {
  it('is the whole viewport when nothing covers it', () => {
    expect(largestFreeRect(portrait, [])).toEqual(portrait);
  });

  it('is the strip between the top bars and the bottom sheets on a portrait phone', () => {
    expect(largestFreeRect(portrait, portraitCovers)).toEqual({
      x: 0,
      y: 86,
      width: 412,
      height: 334,
    });
  });

  it('is the area beside a floating window on a landscape phone', () => {
    expect(largestFreeRect(landscape, landscapeCovers)).toEqual({
      x: 0,
      y: 44,
      width: 591,
      height: 300,
    });
  });

  it('ignores the parts of covers that lie outside the viewport', () => {
    expect(largestFreeRect(portrait, [{ x: -50, y: 700, width: 600, height: 400 }])).toEqual({
      x: 0,
      y: 0,
      width: 412,
      height: 700,
    });
  });
});

describe('revealShift', () => {
  it('leaves a piece that is already in view where it is', () => {
    const piece = { x: 150, y: 200, width: 80, height: 50 };
    expect(revealShift(piece, portrait, portraitCovers)).toBeNull();
  });

  it('leaves a visible piece alone even when it is outside the largest free area', () => {
    const piece = { x: 620, y: 360, width: 60, height: 30 };
    const covers = [...landscapeCovers.slice(0, 2), { x: 0, y: 400, width: 915, height: 12 }];
    expect(revealShift(piece, landscape, covers)).toBeNull();
  });

  it('brings a piece hidden under a bottom sheet into the free area', () => {
    const piece = { x: 150, y: 520, width: 80, height: 50 };
    const after = shifted(piece, portrait, portraitCovers);
    expectCentredIn(after, largestFreeRect(portrait, portraitCovers));
    for (const cover of portraitCovers) expect(overlaps(after, cover)).toBe(false);
  });

  it('brings a piece partly under a floating window beside it', () => {
    const piece = { x: 560, y: 150, width: 90, height: 60 };
    const after = shifted(piece, landscape, landscapeCovers);
    expectCentredIn(after, largestFreeRect(landscape, landscapeCovers));
    for (const cover of landscapeCovers) expect(overlaps(after, cover)).toBe(false);
  });

  it('brings a piece partly past the edge of an uncovered screen fully into view', () => {
    const piece = { x: -20, y: 300, width: 80, height: 50 };
    expect(inside(shifted(piece, portrait, []), portrait)).toBe(true);
  });

  it('brings an off-screen piece back into view', () => {
    const piece = { x: -400, y: -900, width: 70, height: 40 };
    const after = shifted(piece, landscape, landscapeCovers);
    expect(inside(after, largestFreeRect(landscape, landscapeCovers))).toBe(true);
  });

  it('centres a piece larger than the free area on it', () => {
    const piece = { x: 0, y: 300, width: 412, height: 500 };
    expectCentredIn(
      shifted(piece, portrait, portraitCovers),
      largestFreeRect(portrait, portraitCovers),
    );
  });

  describe('with the rails drawn in the piece', () => {
    /** A 4x2 sprite drawn 80x40 at (150,60): only its bottom row of pixels is rail. */
    const rails = {
      x: 150,
      y: 60,
      width: 80,
      height: 40,
      alphaWidth: 4,
      alphaHeight: 2,
      alpha: Uint8Array.from([0, 0, 0, 0, 255, 255, 255, 255]),
    };
    const piece = { x: 150, y: 60, width: 80, height: 40 };

    it('leaves a piece alone when only its transparent margin is under a bar', () => {
      expect(revealShift(piece, portrait, portraitCovers, [rails])).toBeNull();
    });

    it('moves a piece whose rails are under a bar', () => {
      const covers = [{ x: 0, y: 0, width: 412, height: 95 }];
      const shift = revealShift(piece, portrait, covers, [rails]);
      expect(shift).not.toBeNull();
      const moved = { ...rails, x: rails.x + shift!.dx, y: rails.y + shift!.dy };
      expect(revealShift(moved, portrait, covers, [moved])).toBeNull();
    });
  });
});
