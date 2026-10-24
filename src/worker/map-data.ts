import { ElementType } from '../sim/map/tile-map';
import type { TileMap } from '../sim/map/tile-map';

export interface RenderMapData {
  width: number;
  height: number;
  heights: Uint8Array;
  surface: Uint8Array;
  slope: Uint8Array;
  waterLevel: Uint8Array;
  pathElements: Int32Array;
  pathCount: number;
}

export function extractMapData(map: TileMap): RenderMapData {
  const pathElements = new Int32Array(map.elementCapacity * 5);
  let pathCount = 0;
  for (let tile = 0; tile < map.width * map.height; tile++) {
    for (let element = map.firstElement(tile); element >= 0; element = map.nextElement(element)) {
      if (map.elType[element] !== ElementType.Path) continue;
      const offset = pathCount++ * 5;
      pathElements[offset] = tile % map.width;
      pathElements[offset + 1] = Math.floor(tile / map.width);
      pathElements[offset + 2] = map.elBase[element];
      pathElements[offset + 3] = map.elFlags[element];
      pathElements[offset + 4] = map.elData[element];
    }
  }
  return {
    width: map.width,
    height: map.height,
    heights: map.heights.slice(),
    surface: map.surface.slice(),
    slope: map.slope.slice(),
    waterLevel: map.waterLevel.slice(),
    pathElements: pathElements.slice(0, pathCount * 5),
    pathCount,
  };
}
