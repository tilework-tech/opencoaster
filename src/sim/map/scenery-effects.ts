import { ElementType, isPathElementBroken, type TileMap } from './tile-map';

/** Half-open width of the guest's surroundings window, in tiles. */
export const SCENERY_SCAN_WINDOW_TILES = 10;

export interface ScenerySurroundings {
  smallScenery: number;
  largeScenery: number;
  brokenPaths: number;
  rubbishCount: number;
  suppressed: boolean;
}

interface SceneryIndex {
  revision: number;
  stride: number;
  small: Int32Array;
  large: Int32Array;
  broken: Int32Array;
}

const sceneryIndexByMap = new WeakMap<TileMap, SceneryIndex>();

function makePrefix(counts: Int32Array, width: number, height: number): Int32Array {
  const stride = width + 1;
  const prefix = new Int32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowTotal = 0;
    for (let x = 0; x < width; x++) {
      rowTotal += counts[y * width + x];
      prefix[(y + 1) * stride + x + 1] = prefix[y * stride + x + 1] + rowTotal;
    }
  }
  return prefix;
}

function sceneryIndex(map: TileMap): SceneryIndex {
  const cached = sceneryIndexByMap.get(map);
  if (cached?.revision === map.revision) return cached;

  const small = new Int32Array(map.width * map.height);
  const large = new Int32Array(map.width * map.height);
  const broken = new Int32Array(map.width * map.height);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tile = map.index(x, y);
      const cell = y * map.width + x;
      for (let element = map.firstElement(tile); element >= 0; element = map.nextElement(element)) {
        switch (map.elType[element]) {
          case ElementType.SmallScenery:
            small[cell]++;
            break;
          case ElementType.LargeScenery:
            large[cell]++;
            break;
          case ElementType.Path:
            if (isPathElementBroken(map, element)) broken[cell]++;
            break;
        }
      }
    }
  }

  const index = {
    revision: map.revision,
    stride: map.width + 1,
    small: makePrefix(small, map.width, map.height),
    large: makePrefix(large, map.width, map.height),
    broken: makePrefix(broken, map.width, map.height),
  };
  sceneryIndexByMap.set(map, index);
  return index;
}

function rectangleSum(
  prefix: Int32Array,
  stride: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  return (
    prefix[y1 * stride + x1] -
    prefix[y0 * stride + x1] -
    prefix[y1 * stride + x0] +
    prefix[y0 * stride + x0]
  );
}

export function emptyScenerySurroundings(): ScenerySurroundings {
  return { smallScenery: 0, largeScenery: 0, brokenPaths: 0, rubbishCount: 0, suppressed: false };
}

/**
 * Counts scenery and broken path pieces in the guest's clipped surroundings window. Writes into
 * `out` so the per-guest hot path can reuse one result object instead of allocating each scan.
 */
export function countScenerySurroundings(
  map: TileMap,
  centerX: number,
  centerY: number,
  scanningHeight: number,
  litterCount: number,
  out: ScenerySurroundings = emptyScenerySurroundings(),
): ScenerySurroundings {
  out.smallScenery = 0;
  out.largeScenery = 0;
  out.brokenPaths = 0;
  out.rubbishCount = 0;
  out.suppressed = false;
  if (
    !Number.isInteger(centerX) ||
    !Number.isInteger(centerY) ||
    centerX < 0 ||
    centerY < 0 ||
    centerX >= map.width ||
    centerY >= map.height
  ) {
    return out;
  }

  const centerIndex = map.index(centerX, centerY);
  if (map.heights[centerIndex] > scanningHeight) {
    out.suppressed = true;
    return out;
  }

  const windowStartX = centerX - Math.floor(SCENERY_SCAN_WINDOW_TILES / 2);
  const windowStartY = centerY - Math.floor(SCENERY_SCAN_WINDOW_TILES / 2);
  const x0 = Math.max(0, windowStartX);
  const y0 = Math.max(0, windowStartY);
  const x1 = Math.min(map.width, windowStartX + SCENERY_SCAN_WINDOW_TILES);
  const y1 = Math.min(map.height, windowStartY + SCENERY_SCAN_WINDOW_TILES);
  const index = sceneryIndex(map);
  out.smallScenery = rectangleSum(index.small, index.stride, x0, y0, x1, y1);
  out.largeScenery = rectangleSum(index.large, index.stride, x0, y0, x1, y1);
  out.brokenPaths = rectangleSum(index.broken, index.stride, x0, y0, x1, y1);
  out.rubbishCount = out.brokenPaths + litterCount;
  return out;
}
