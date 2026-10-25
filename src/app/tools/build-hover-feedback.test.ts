import { describe, expect, it } from 'vitest';
import { buildHoverGhost } from './build-hover-feedback';

describe('build hover feedback', () => {
  it('marks unbuildable tiles for every placement and terrain tool', () => {
    const buildable = new Uint8Array([1, 0, 0, 1]);

    expect(buildHoverGhost('path', [1, 0], 2, 2, buildable)).toEqual({ x: 1, y: 0 });
    expect(buildHoverGhost('land', [0, 1], 2, 2, buildable)).toEqual({ x: 0, y: 1 });
    expect(buildHoverGhost('ride', [0, 1], 2, 2, buildable)).toEqual({ x: 0, y: 1 });
    expect(buildHoverGhost('track', [0, 0], 2, 2, buildable)).toBeNull();
    expect(buildHoverGhost('buy-land', [1, 0], 2, 2, buildable)).toBeNull();
    expect(buildHoverGhost('select', [1, 0], 2, 2, buildable)).toBeNull();
  });

  it('does not show a land warning without a valid map tile', () => {
    const buildable = new Uint8Array([0]);

    expect(buildHoverGhost('path', null, 1, 1, buildable)).toBeNull();
    expect(buildHoverGhost('path', [-1, 0], 1, 1, buildable)).toBeNull();
    expect(buildHoverGhost('path', [0, 0], 1, 1, undefined)).toBeNull();
  });
});
