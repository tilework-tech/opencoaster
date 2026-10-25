import { describe, expect, it } from 'vitest';
import { pieceCornerLevels } from './ghost';

describe('pieceCornerLevels', () => {
  it('keeps a flat piece on one level', () => {
    expect(pieceCornerLevels(3, -1)).toEqual([3, 3, 3, 3]);
  });

  it('raises the two corners on the side the piece rises toward', () => {
    expect(pieceCornerLevels(3, 0)).toEqual([3, 4, 4, 3]);
    expect(pieceCornerLevels(3, 1)).toEqual([3, 3, 4, 4]);
    expect(pieceCornerLevels(3, 2)).toEqual([4, 3, 3, 4]);
    expect(pieceCornerLevels(3, 3)).toEqual([4, 4, 3, 3]);
  });
});
