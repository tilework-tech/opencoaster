import { describe, expect, it } from 'vitest';
import { PathFlag, PathStyle, SLOPE_DIR_SHIFT } from '../../../sim/map/tile-map';
import { PathResult } from '../../../sim/map/paths';
import type { PathPiecePreview } from '../../../sim/map/map-commands';
import { pathPieceGhosts, pieceCornerLevels } from './ghost';

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

describe('pathPieceGhosts', () => {
  const map = { width: 4, height: 4, heights: new Uint8Array(16).fill(2) };
  const piece = (over: Partial<PathPiecePreview>): PathPiecePreview => ({
    result: PathResult.Ok,
    z: 3,
    dir: -1,
    queue: false,
    style: PathStyle.Dirt,
    edges: 0,
    ...over,
  });

  it('draws an accepted piece at its base level with its connections and queue flag', () => {
    const [ghost] = pathPieceGhosts(
      [{ tile: { x: 1, y: 2 }, tone: 'ok', piece: piece({ edges: 0b0101, queue: true }) }],
      map,
      PathStyle.Tarmac,
    );
    expect(ghost).toEqual({
      x: 1,
      y: 2,
      level: 3,
      flags: PathFlag.Queue | 0b0101,
      surface: PathStyle.Dirt,
      tone: 'ok',
    });
  });

  it('sets the slope and its direction for a ramp', () => {
    const [ghost] = pathPieceGhosts(
      [{ tile: { x: 0, y: 0 }, tone: 'ok', piece: piece({ dir: 2 }) }],
      map,
      PathStyle.Tarmac,
    );
    expect(ghost!.flags).toBe(PathFlag.Sloped | (2 << SLOPE_DIR_SHIFT));
  });

  it('draws a refused tile flat on the ground in the chosen surface', () => {
    const [ghost] = pathPieceGhosts(
      [
        {
          tile: { x: 3, y: 1 },
          tone: 'refused',
          piece: piece({ result: PathResult.Blocked }),
        },
      ],
      { ...map, heights: new Uint8Array(16).fill(5) },
      PathStyle.CrazyPaving,
    );
    expect(ghost).toEqual({
      x: 3,
      y: 1,
      level: 5,
      flags: 0,
      surface: PathStyle.CrazyPaving,
      tone: 'refused',
    });
  });

  it('leaves out paved and pending tiles', () => {
    expect(
      pathPieceGhosts(
        [
          { tile: { x: 0, y: 0 }, tone: 'paved' },
          { tile: { x: 1, y: 0 }, tone: 'pending' },
        ],
        map,
        PathStyle.Tarmac,
      ),
    ).toEqual([]);
  });
});
