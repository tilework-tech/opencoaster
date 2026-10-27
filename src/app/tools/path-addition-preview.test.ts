import { describe, expect, it } from 'vitest';
import { Z_STEP } from '../../sim/core/constants';
import { PathFlag } from '../../sim/map/tile-map';
import { PATH_SURFACE_Z } from '../../render/ground-anchor';
import { pathAdditionPreviewGhosts } from './path-addition-preview';

function mapWithPath(flags: number) {
  return {
    width: 3,
    height: 3,
    heights: new Uint8Array(9),
    surface: new Uint8Array(9),
    slope: new Uint8Array(9),
    pathElements: Int32Array.of(1, 1, 2, flags, 0, 0),
    pathCount: 1,
  };
}

describe('path addition placement preview', () => {
  it.each([
    ['straight', 0b0101, 2],
    ['corner', 0b0011, 2],
    ['T-junction', 0b0111, 1],
    ['crossroads', 0b1111, 0],
    ['dead-end', 0b0001, 3],
  ])('previews %s props on every open edge, as rendering does', (_shape, edges, count) => {
    const ghosts = pathAdditionPreviewGhosts(mapWithPath(edges), 1, 1, 'bench', 0);
    expect(ghosts).toHaveLength(count);
    for (const ghost of ghosts) {
      expect(ghost.kind).toBe('path-addition');
      expect(ghost.width).toBeUndefined();
      expect(ghost.height).toBeUndefined();
    }
  });

  it('rotates the preview around all four views and follows a sloped edge height', () => {
    const flags = PathFlag.Sloped | 0b0101;
    const sprites = Array.from({ length: 4 }, (_, rotation) =>
      pathAdditionPreviewGhosts(mapWithPath(flags), 1, 1, 'bench', rotation).map(
        (ghost) => ghost.sprite,
      ),
    );
    expect(sprites).toEqual([
      ['scenery/bench/view-1', 'scenery/bench/view-3'],
      ['scenery/bench/view-2', 'scenery/bench/view-0'],
      ['scenery/bench/view-3', 'scenery/bench/view-1'],
      ['scenery/bench/view-0', 'scenery/bench/view-2'],
    ]);
    const sloped = pathAdditionPreviewGhosts(mapWithPath(flags), 1, 1, 'bench', 0);
    for (const { level } of sloped)
      expect(level).toBeCloseTo(2 + (Z_STEP / 2 + PATH_SURFACE_Z) / Z_STEP);
  });

  it('previews four lamp posts on a crossroads', () => {
    expect(pathAdditionPreviewGhosts(mapWithPath(0b1111), 1, 1, 'lamp', 0)).toHaveLength(4);
    expect(pathAdditionPreviewGhosts(mapWithPath(0b1111), 1, 1, 'bin', 0)).toHaveLength(0);
  });
});
