import { describe, expect, it } from 'vitest';
import {
  TERRAIN_SLOPE_NAMES,
  atlasFrameOrFallback,
  pathSpriteName,
  scenerySpriteName,
  spriteViewName,
  terrainSpriteName,
  terrainSurfaceSpriteName,
  waterFrameIndex,
} from './world-art';

describe('world art sprite selection', () => {
  it('selects one authored terrain shape for every corner-height mask and surface', () => {
    const surfaces = ['grass', 'dirt', 'sand', 'rock'] as const;
    for (const surface of surfaces) {
      for (let mask = 0; mask < 16; mask++) {
        expect(terrainSpriteName(surface, mask)).toBe(
          `terrain/${surface}/shape-${mask.toString(16).padStart(2, '0')}`,
        );
      }
    }
    expect(TERRAIN_SLOPE_NAMES).toHaveLength(16);
    expect(new Set(TERRAIN_SLOPE_NAMES).size).toBe(16);
    expect(surfaces.map(terrainSurfaceSpriteName)).toEqual(
      surfaces.map((surface) => `terrain/${surface}/surface`),
    );
  });

  it('selects every connected-path shape for each path material and ramp direction', () => {
    for (const surface of ['tarmac', 'crazy-paving', 'dirt'] as const) {
      for (let edges = 0; edges < 16; edges++) {
        expect(pathSpriteName(surface, edges)).toBe(
          `paths/${surface}/connection-${edges.toString(16).padStart(2, '0')}`,
        );
      }
      for (const direction of [0, 1, 2, 3]) {
        expect(pathSpriteName(surface, 0, direction)).toBe(`paths/${surface}/ramp-${direction}`);
      }
    }
  });

  it('cycles four water frames at five frames per second on the 40 Hz simulation clock', () => {
    expect([0, 7, 8, 16, 24, 31, 32].map(waterFrameIndex)).toEqual([0, 0, 1, 2, 3, 3, 0]);
  });

  it('uses a documented sprite when the requested art is missing', () => {
    expect(atlasFrameOrFallback({}, 'trees/tree-oak', 'fallback/tree')).toBe('fallback/tree');
    expect(
      atlasFrameOrFallback(
        { 'trees/tree-oak': { frames: ['oak-frame'] } },
        'trees/tree-oak',
        'fallback/tree',
      ),
    ).toBe('oak-frame');
  });

  it('provides four explicit views for asymmetric scenery and stable names for park objects', () => {
    expect([0, 1, 2, 3].map((rotation) => spriteViewName('trees/tree-oak', rotation))).toEqual([
      'trees/tree-oak/view-0',
      'trees/tree-oak/view-1',
      'trees/tree-oak/view-2',
      'trees/tree-oak/view-3',
    ]);
    expect(scenerySpriteName('flower-bed')).toBe('scenery/flower-bed');
    expect(scenerySpriteName('bench')).toBe('scenery/bench');
    expect(scenerySpriteName('entrance-gate')).toBe('scenery/entrance-gate');
  });
});
