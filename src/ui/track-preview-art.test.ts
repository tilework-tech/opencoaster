import { describe, expect, it } from 'vitest';
import { RideType } from '../sim/rides/ride-types';
import { pieceByName } from '../sim/track/catalog';
import { trackPreviewSprites } from './track-preview-art';

describe('track placement preview art', () => {
  it('uses the selected coaster family and includes every footprint cell', () => {
    const piece = pieceByName('smallRight')!;
    const cells = trackPreviewSprites(RideType.SteelLoopingCoaster, piece.id, 1, 2, 0);

    expect(cells).toHaveLength(piece.footprint.length);
    expect(cells[0].key).toBe('rides/coaster/steel/track/smallRight/view-3/cell-0');
  });

  it('uses the miniature railway track family for transport previews', () => {
    const piece = pieceByName('flat')!;
    const cells = trackPreviewSprites(RideType.MiniatureRailway, piece.id, 0, 0, 0);

    expect(cells[0].key).toBe('track/miniature-railway/flat/view-0/cell-0');
  });
});
