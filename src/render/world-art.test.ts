import { describe, expect, it } from 'vitest';
import {
  ambientTreeName,
  flowerBedSpriteName,
  pathElementSprite,
  queueRailSprites,
} from './world-art';
import { PathFlag, SLOPE_DIR_SHIFT } from '../sim/map/tile-map';
import { RideType } from '../sim/rides/ride-types';
import { RidePhase } from '../sim/rides/ride-store';
import {
  TERRAIN_SLOPE_NAMES,
  atlasFrameOrFallback,
  pathSpriteName,
  scenerySpriteName,
  wallSpriteName,
  spriteAnchorWorldOffset,
  spriteViewName,
  terrainSpriteName,
  terrainCliffSpriteName,
  terrainSurfaceSpriteName,
  WATER_BANK,
  nativeSpriteWorldOffset,
  rideSpriteFrame,
  rideSpriteKey,
  rideSpriteName,
  ridePreviewSpriteKey,
  shrubSpriteName,
  waterFrameIndex,
  waterSpriteName,
} from './world-art';

describe('world art sprite selection', () => {
  it('selects the ride-preview view using both ride and camera rotation', () => {
    for (let rideDir = 0; rideDir < 4; rideDir++)
      for (let cameraRotation = 0; cameraRotation < 4; cameraRotation++)
        expect(ridePreviewSpriteKey(RideType.SwingingShip, rideDir, cameraRotation)).toBe(
          `rides/flat/swinging-ship/preview/view-${(rideDir + cameraRotation) & 3}`,
        );
  });

  it('selects four stable shrub variants for each camera view', () => {
    const coordinates = Array.from({ length: 16 }, (_, index) => [index, 0] as const);
    const names = coordinates.map(([x, y]) => shrubSpriteName(x, y, 2));
    expect(names).toEqual(coordinates.map(([x, y]) => shrubSpriteName(x, y, 2)));
    expect(new Set(names).size).toBe(4);
    for (const name of names) expect(name).toMatch(/^scenery\/shrub\/variant-[0-3]\/view-2$/);
    expect(shrubSpriteName(5, 7, 3)).toBe(shrubSpriteName(5, 7, 7));
  });
  it('selects wall art by edge orientation, terrain slope and camera view', () => {
    for (const wall of ['hedge', 'wooden-fence', 'stone-fence']) {
      for (let edge = 0; edge < 4; edge++) {
        for (let slope = 0; slope < 16; slope++) {
          for (let view = 0; view < 4; view++) {
            expect(wallSpriteName(wall, edge, slope, view)).toBe(
              `scenery/${wall}/edge-${edge}/slope-${slope}/view-${view}`,
            );
          }
        }
      }
    }
  });
  it('chooses desert trees on sand and temperate trees on grass', () => {
    expect(ambientTreeName(1, 4, 1)).toBe('tree-cactus');
    expect(ambientTreeName(1, 27, 1)).toBe('tree-palm');
    expect(ambientTreeName(0, 4, 1)).toBe('tree-topiary');
    expect(ambientTreeName(4, 4, 1)).toBeNull();
  });

  it('selects a camera-facing view for palms and cacti in every map rotation', () => {
    for (const tree of ['tree-palm', 'tree-cactus']) {
      expect([0, 1, 2, 3].map((rotation) => scenerySpriteName(tree, rotation))).toEqual(
        [0, 1, 2, 3].map((view) => `trees/${tree}/view-${view}`),
      );
    }
    expect(scenerySpriteName('tree-oak', 2)).toBe('trees/tree-oak');
  });
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

  it('adds a rail sprite for each open edge of a flat queue piece that faces the camera', () => {
    const queue = PathFlag.Queue;
    expect(queueRailSprites(queue | 0b1100, 0).map((r) => r.sprite)).toEqual([
      'paths/queue/rail-0',
      'paths/queue/rail-1',
    ]);
    expect(queueRailSprites(queue | 0b0101, 0).map((r) => r.sprite)).toEqual([
      'paths/queue/rail-1',
    ]);
    expect(queueRailSprites(queue | 0b0101, 1)).toEqual([
      { sprite: 'paths/queue/rail-0', worldDir: 3 },
    ]);
    expect(queueRailSprites(0b0101, 0)).toEqual([]);
    expect(queueRailSprites(queue | PathFlag.Sloped, 0)).toEqual([]);
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
    expect(
      [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map(([x, y]) => [0, 1, 2, 3].map((rotation) => flowerBedSpriteName(x, y, rotation))),
    ).toEqual(
      [0, 1, 2, 3].map((variant) =>
        [0, 1, 2, 3].map((rotation) => `scenery/flower-bed/variant-${variant}/view-${rotation}`),
      ),
    );
    expect(flowerBedSpriteName(-1, 0, -1)).toBe('scenery/flower-bed/variant-3/view-3');
    expect(flowerBedSpriteName(0, 0, 1, 0b1100)).toBe(
      'scenery/flower-bed/slope-12/variant-0/view-1',
    );
    expect(scenerySpriteName('flower-bed')).toBe('scenery/flower-bed');
    expect(scenerySpriteName('bench')).toBe('scenery/bench');
    expect(scenerySpriteName('entrance-gate')).toBe('scenery/entrance-gate');
  });

  it('selects ride views and keeps idle rides in their empty frame', () => {
    expect([0, 1, 2, 3].map((rotation) => rideSpriteKey(1, rotation))).toEqual([
      'rides/flat/merry-go-round/view-0',
      'rides/flat/merry-go-round/view-1',
      'rides/flat/merry-go-round/view-2',
      'rides/flat/merry-go-round/view-3',
    ]);
    expect(rideSpriteName(5)).toBe('stalls/food-stall');
    expect(rideSpriteFrame(0, 80, 9)).toBe(0);
    expect(rideSpriteFrame(2, 0, 9)).toBe(1);
    expect(rideSpriteFrame(2, 64, 9)).toBe(1);
    expect(rideSpriteFrame(2, 8, 9)).toBe(2);
    expect(rideSpriteFrame(RidePhase.Loading, 80, 73, 0)).toBe(0);
    expect(rideSpriteFrame(RidePhase.Running, 0, 73, 0)).toBe(1);
    expect(rideSpriteFrame(RidePhase.Running, 80, 73, 8)).toBe(2);
    expect(rideSpriteFrame(RidePhase.Unloading, 400, 73, 200)).toBe(0);
  });

  it('aligns native sprites by moving the centred quad from the anchor to the projected point', () => {
    expect(nativeSpriteWorldOffset(64, 32)).toBe(0);
    expect(nativeSpriteWorldOffset(64, 48)).toBe(64);
    expect(nativeSpriteWorldOffset(64, 16)).toBe(-64);
  });

  it('converts sprite anchors from rendered pixels into world-height units', () => {
    expect(spriteAnchorWorldOffset(48, 48, 72)).toBe(144);
    expect(spriteAnchorWorldOffset(48, 24, 72)).toBe(0);
    expect(spriteAnchorWorldOffset(48, 0, 72)).toBe(-144);
  });
});

describe('footpath element sprites', () => {
  it('names the surface connection for a flat piece at the unrotated camera', () => {
    expect(pathElementSprite(0b0101, 0, 0)).toBe('paths/tarmac/connection-05');
  });

  it('uses the queue art for queue pieces regardless of surface', () => {
    expect(pathElementSprite(PathFlag.Queue | 0b0001, 2, 0)).toBe('paths/queue/connection-01');
  });

  it('names the ramp for a sloped piece by its slope direction', () => {
    expect(pathElementSprite(PathFlag.Sloped | (2 << SLOPE_DIR_SHIFT), 2, 0)).toBe(
      'paths/dirt/ramp-2',
    );
  });

  it('turns the connections with the camera rotation', () => {
    expect(pathElementSprite(0b0001, 0, 1)).toBe('paths/tarmac/connection-02');
  });
});
