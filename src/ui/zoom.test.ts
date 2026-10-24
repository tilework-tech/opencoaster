import { describe, expect, it } from 'vitest';
import { DEFAULT_ZOOM, ZOOM_LEVELS, stepZoom } from './zoom';

describe('discrete zoom', () => {
  it('has four levels and defaults to one of them', () => {
    expect(ZOOM_LEVELS).toHaveLength(4);
    expect(ZOOM_LEVELS).toContain(DEFAULT_ZOOM);
  });

  it('moves exactly one level per step and stops at the ends', () => {
    expect(stepZoom(1, 1)).toBe(2);
    expect(stepZoom(1, -1)).toBe(0.5);
    expect(stepZoom(ZOOM_LEVELS[ZOOM_LEVELS.length - 1], 1)).toBe(
      ZOOM_LEVELS[ZOOM_LEVELS.length - 1],
    );
    expect(stepZoom(ZOOM_LEVELS[0], -1)).toBe(ZOOM_LEVELS[0]);
  });

  it('snaps an in-between value to the nearest level first', () => {
    expect(stepZoom(1.2, 1)).toBe(2);
    expect(stepZoom(1.9, -1)).toBe(1);
  });
});
