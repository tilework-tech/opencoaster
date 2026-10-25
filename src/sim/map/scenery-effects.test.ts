import { describe, expect, it } from 'vitest';
import { countScenerySurroundings } from './scenery-effects';
import { ElementType, markPathElementBroken, TileMap } from './tile-map';

function mapWithElements(): TileMap {
  const map = new TileMap(20, 20, 256);
  map.fillFlat(4);
  return map;
}

function add(map: TileMap, x: number, y: number, type: ElementType, base = 4): void {
  map.addElement(map.index(x, y), type, base, base + 1, 0, 0);
}

describe('guest scenery surroundings', () => {
  it('counts small and large scenery plus broken paths inside the 10-by-10 window', () => {
    const map = mapWithElements();
    add(map, 5, 5, ElementType.SmallScenery);
    add(map, 14, 14, ElementType.LargeScenery);
    const brokenPath = map.addElement(map.index(10, 10), ElementType.Path, 4, 5, 0, 0);
    markPathElementBroken(map, brokenPath);

    // These elements sit just outside the half-open [center - 5, center + 5) window.
    add(map, 15, 10, ElementType.SmallScenery);
    add(map, 10, 15, ElementType.Path);
    add(map, 10, 10, ElementType.Wall);
    add(map, 10, 10, ElementType.Track);

    expect(countScenerySurroundings(map, 10, 10, 4, 2)).toEqual({
      smallScenery: 1,
      largeScenery: 1,
      brokenPaths: 1,
      rubbishCount: 3,
      suppressed: false,
    });
  });

  it('suppresses the scan when the guest tile base is above the scanning height', () => {
    const map = mapWithElements();
    map.fillFlat(6);
    add(map, 10, 10, ElementType.SmallScenery, 6);

    expect(countScenerySurroundings(map, 10, 10, 5, 2)).toEqual({
      smallScenery: 0,
      largeScenery: 0,
      brokenPaths: 0,
      rubbishCount: 0,
      suppressed: true,
    });
  });

  it('includes scenery when the guest tile base equals the scanning height', () => {
    const map = mapWithElements();
    add(map, 10, 10, ElementType.SmallScenery);

    expect(countScenerySurroundings(map, 10, 10, 4, 0)).toEqual({
      smallScenery: 1,
      largeScenery: 0,
      brokenPaths: 0,
      rubbishCount: 0,
      suppressed: false,
    });
  });

  it('reflects scenery added after an earlier scan', () => {
    const map = mapWithElements();
    expect(countScenerySurroundings(map, 10, 10, 4, 0).smallScenery).toBe(0);

    add(map, 10, 10, ElementType.SmallScenery);

    expect(countScenerySurroundings(map, 10, 10, 4, 0).smallScenery).toBe(1);
  });
});
