import { describe, expect, it } from 'vitest';
import {
  TERRAIN_SLOPE_NAMES,
  atlasFrameOrFallback,
  pathSpriteName,
  scenerySpriteName,
  spriteViewName,
  terrainSpriteName,
  terrainCliffSpriteName,
  terrainSurfaceSpriteName,
  WATER_BANK,
  nativeSpriteWorldOffset,
  rideSpriteFrame,
  rideSpriteKey,
  waterFrameIndex,
  waterSpriteName,
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

  it('selects cardinal material-specific cliff-face artwork', () => {
    for (const surface of ['grass', 'dirt', 'sand', 'rock'] as const) {
      for (const direction of [0, 1, 2, 3])
        expect(terrainCliffSpriteName(surface, direction)).toBe(
          `terrain/${surface}/cliff-face-${direction}`,
        );
    }
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

  it('turns path connection masks and ramp directions with the camera rotation', () => {
    expect(pathSpriteName('tarmac', 0b0001, undefined, 1)).toBe('paths/tarmac/connection-02');
    expect(pathSpriteName('tarmac', 0b1000, undefined, 1)).toBe('paths/tarmac/connection-01');
    expect(pathSpriteName('queue', 0b0101, undefined, 2)).toBe('paths/queue/connection-05');
    expect(pathSpriteName('dirt', 0, 3, 2)).toBe('paths/dirt/ramp-1');
  });

  it('cycles eight water palette frames at five frames per second on the 40 Hz simulation clock', () => {
    expect([0, 7, 8, 16, 56, 63, 64].map(waterFrameIndex)).toEqual([0, 0, 1, 2, 7, 7, 0]);
    expect(waterSpriteName(9)).toBe('water/surface#1');
  });

  it('keeps the water bank bands ordered from the shoreline outwards', () => {
    expect(WATER_BANK.foamDepth).toBeGreaterThan(0);
    expect(WATER_BANK.shallowDepth).toBeGreaterThan(WATER_BANK.foamDepth);
    expect(WATER_BANK.deepDepth).toBeGreaterThan(WATER_BANK.shallowDepth);
    expect(WATER_BANK.surfaceInset).toBeGreaterThan(0);
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

  it('selects ride views and keeps idle rides in their empty frame', () => {
    expect([0, 1, 2, 3].map((rotation) => rideSpriteKey(1, rotation))).toEqual([
      'rides/merry-go-round/view-0',
      'rides/merry-go-round/view-1',
      'rides/merry-go-round/view-2',
      'rides/merry-go-round/view-3',
    ]);
    expect(rideSpriteFrame(0, 80, 9)).toBe(0);
    expect(rideSpriteFrame(2, 0, 9)).toBe(1);
    expect(rideSpriteFrame(2, 64, 9)).toBe(1);
    expect(rideSpriteFrame(2, 8, 9)).toBe(2);
  });

  it('aligns native sprites by moving the centred quad from the anchor to the projected point', () => {
    expect(nativeSpriteWorldOffset(64, 32)).toBe(0);
    expect(nativeSpriteWorldOffset(64, 48)).toBe(64);
    expect(nativeSpriteWorldOffset(64, 16)).toBe(-64);
  });
});
