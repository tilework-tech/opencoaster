import { describe, expect, it } from 'vitest';
import { buildTextureRuns } from './texture-runs';

describe('WebGL texture batches', () => {
  it('splits painter ordered sprites before an instance needs a ninth page', () => {
    const { runs, slots } = buildTextureRuns([0, 1, 2, 3, 4, 5, 6, 7, 8, 0], 8);

    expect(runs).toEqual([
      { start: 0, count: 8, pages: [0, 1, 2, 3, 4, 5, 6, 7] },
      { start: 8, count: 2, pages: [8, 0] },
    ]);
    expect(slots).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0, 1]);
  });

  it('reuses a page slot while it remains in the current run', () => {
    const { runs, slots } = buildTextureRuns([4, 9, 4, 9], 2);

    expect(runs).toEqual([{ start: 0, count: 4, pages: [4, 9] }]);
    expect(slots).toEqual([0, 1, 0, 1]);
  });
});
