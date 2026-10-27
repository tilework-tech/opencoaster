import { describe, expect, it } from 'vitest';
import { PathFlag, PATH_ADDITION_BROKEN } from '../sim/map/tile-map';
import { RideType } from '../sim/rides/ride-types';
import {
  carSpriteKey,
  trackCellSprites,
  transportCarSpriteKey,
  transportTrackCells,
} from './coaster-art';
import { objectKind } from './object-kinds';
import { peopleSpriteKey } from './people-art';
import { staffSpriteName } from './webgl2-renderer';
import {
  facilitySpriteKey,
  flowerBedSpriteName,
  litterSpriteName,
  pathAdditionSpriteName,
  pathElementSprite,
  queueRailSprites,
  rideCellSpriteKey,
  rideHutSpriteKey,
  rideSpriteKey,
  scenerySpriteName,
  shrubSpriteName,
  spriteViewName,
  terrainCliffSpriteName,
  terrainSurfaceSpriteName,
  wallSpriteName,
  waterSpriteName,
} from './world-art';

describe('objectKind', () => {
  it('classifies ground, water and paths', () => {
    expect(objectKind(terrainSurfaceSpriteName('grass'))).toBe('ground');
    expect(objectKind(terrainCliffSpriteName('rock', 2))).toBe('ground');
    expect(objectKind(waterSpriteName(3))).toBe('water');
    expect(objectKind(pathElementSprite(0b0101, 0, 1))).toBe('path');
    expect(objectKind(pathElementSprite(PathFlag.Queue | PathFlag.Sloped, 0, 0))).toBe('path');
    expect(objectKind(queueRailSprites(PathFlag.Queue, 0)[0]!.sprite)).toBe('path');
  });

  it('classifies path additions and shelters', () => {
    for (const flag of [PathFlag.Bench, PathFlag.Bin, PathFlag.Lamp]) {
      expect(objectKind(pathAdditionSpriteName(flag, 2, 0))).toBe('path-addition');
      expect(objectKind(pathAdditionSpriteName(flag, 2, PATH_ADDITION_BROKEN))).toBe(
        'path-addition',
      );
    }
    expect(objectKind(pathAdditionSpriteName(PathFlag.Shelter, 1, 0))).toBe('shelter');
  });

  it('classifies trees, scenery, walls, flowerbeds and the park gate', () => {
    expect(objectKind(scenerySpriteName('tree-oak'))).toBe('tree');
    expect(objectKind(scenerySpriteName('tree-palm', 3))).toBe('tree');
    expect(objectKind(shrubSpriteName(4, 5, 1))).toBe('scenery');
    expect(objectKind(wallSpriteName('hedge', 1, 0b0011, 2))).toBe('wall');
    expect(objectKind(wallSpriteName('stone-fence', 0, 0, 0))).toBe('wall');
    expect(objectKind(flowerBedSpriteName(2, 3, 1))).toBe('flowerbed');
    expect(objectKind(flowerBedSpriteName(2, 3, 1, 0b0110))).toBe('flowerbed');
    expect(objectKind(spriteViewName(scenerySpriteName('park-entrance'), 2))).toBe('park-gate');
  });

  it('classifies people', () => {
    expect(objectKind('people/guest-walk#37')).toBe('guest');
    expect(objectKind(`${peopleSpriteKey(2, 1, 3)}#2`)).toBe('staff');
    expect(objectKind(staffSpriteName(3))).toBe('staff');
    expect(objectKind('people/rider-seated#12')).toBe('rider');
  });

  it('classifies flat rides, stalls and ride huts', () => {
    expect(objectKind(`${rideCellSpriteKey(RideType.MerryGoRound, 0, 1, 2)}#3`)).toBe('flat-ride');
    expect(objectKind(rideSpriteKey(RideType.TopSpin, 1))).toBe('flat-ride');
    expect(objectKind(rideSpriteKey(RideType.GoKarts, 0))).toBe('flat-ride');
    expect(objectKind(facilitySpriteKey(RideType.FoodStall, 1, 2))).toBe('stall');
    expect(objectKind(facilitySpriteKey(RideType.Toilets, 0, 0))).toBe('stall');
    for (const type of [RideType.FerrisWheel, RideType.WoodenCoaster, RideType.Chairlift]) {
      expect(objectKind(rideHutSpriteKey(type, 'entrance', 1, 2))).toBe('entrance');
      expect(objectKind(rideHutSpriteKey(type, 'exit', 3, 0))).toBe('exit');
    }
    expect(objectKind(litterSpriteName(1, 2))).toBe('litter');
  });

  it('classifies track, supports and vehicles of every track family', () => {
    for (const family of ['wood', 'steel', 'junior', 'mouse', 'log-flume'] as const) {
      for (const cell of trackCellSprites(0, 1, 2, family, 0, 0))
        expect(objectKind(cell.key)).toBe('track');
      expect(objectKind(carSpriteKey(family, 3, 0, 0, 1, 2))).toBe('vehicle');
    }
    for (const cell of transportTrackCells(0, 0, 1, 'monorail'))
      expect(objectKind(cell.key)).toBe('track');
    expect(objectKind(transportCarSpriteKey('chairlift', 2, 0, 1))).toBe('vehicle');
    expect(objectKind('rides/coaster/steel/support-column/view-1')).toBe('support');
    expect(objectKind('rides/coaster/wood/support-cap2/view-0')).toBe('support');
    expect(objectKind('rides/coaster/junior/support-base/view-3')).toBe('support');
  });

  it('falls back to other for unknown keys', () => {
    expect(objectKind('')).toBe('other');
    expect(objectKind('mystery/thing')).toBe('other');
  });
});
