import type { World } from '../core/world';
import { OWNED, RIGHTS_OWNED, SALE_LAND, SALE_RIGHTS } from '../map/tile-map';
import { ElementType, Surface } from '../map/tile-map';
import { rideFootprintTiles } from '../rides/ride-footprint';
import { RIDE_CATALOG } from '../rides/ride-types';
import type { RideType } from '../rides/ride-types';

export const SCENARIO_PREVIEW_RENDERER_VERSION = 2;

export interface ScenarioPreviewPixels {
  width: number;
  height: number;
  pixels: Uint8Array;
}

const COLORS = {
  grass: [111, 151, 69],
  sand: [211, 181, 103],
  dirt: [147, 105, 68],
  rock: [126, 129, 127],
  water: [54, 133, 169],
  owned: [69, 114, 57],
  landForSale: [197, 166, 77],
  rightsForSale: [70, 132, 155],
  rightsOwned: [130, 159, 83],
  unowned: [61, 68, 60],
  path: [230, 211, 161],
  queue: [249, 225, 132],
  ride: [183, 76, 65],
  smallScenery: [39, 98, 47],
  largeScenery: [122, 78, 132],
  entrance: [239, 123, 54],
} as const;

/** Builds a tile-per-pixel overview from an already prepared scenario world. */
export function renderScenarioPreview(world: World): ScenarioPreviewPixels {
  const { map } = world;
  const pixels = new Uint8Array(map.width * map.height * 4);
  const rideTiles = new Uint8Array(map.width * map.height);
  const rides = world.rides.cols;

  for (let slot = 0; slot < world.rides.count; slot++) {
    const rideType = rides.typeId[slot] as RideType;
    const definition = RIDE_CATALOG[rideType];
    if (!definition) continue;
    for (const [x, y] of rideFootprintTiles(
      definition,
      rides.rideX[slot],
      rides.rideY[slot],
      rides.dir[slot],
    )) {
      if (map.inBounds(x, y)) rideTiles[map.index(x, y)] = 1;
    }
  }

  let maxHeight = 1;
  for (let i = 0; i < map.heights.length; i++) maxHeight = Math.max(maxHeight, map.heights[i]);

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tile = map.index(x, y);
      const pixel = tile * 4;
      let color: readonly number[] = terrainColor(map.terrain[tile]);
      const height = map.heights[tile];
      const shade = 184 + Math.round((height * 71) / maxHeight);
      color = color.map((channel) => Math.round((channel * shade) / 220));

      if (map.waterLevel[tile] > height) color = COLORS.water;
      else {
        const ownership = map.ownership[tile];
        if (ownership & OWNED) color = blend(color, COLORS.owned, 0.14);
        else if (ownership & SALE_LAND) color = blend(color, COLORS.landForSale, 0.58);
        else if (ownership & SALE_RIGHTS) color = blend(color, COLORS.rightsForSale, 0.58);
        else if (ownership & RIGHTS_OWNED) color = blend(color, COLORS.rightsOwned, 0.58);
        else color = blend(color, COLORS.unowned, 0.7);
      }

      let hasPath = false;
      let hasQueue = false;
      let hasTrack = false;
      let scenery: ElementType.SmallScenery | ElementType.LargeScenery | undefined;
      for (let element = map.tileHead[tile]; element >= 0; element = map.elNext[element]) {
        switch (map.elType[element]) {
          case ElementType.Path:
            hasPath = true;
            hasQueue ||= (map.elFlags[element] & 0x100) !== 0;
            break;
          case ElementType.Track:
            hasTrack = true;
            break;
          case ElementType.SmallScenery:
          case ElementType.LargeScenery:
            scenery = map.elType[element];
            break;
        }
      }

      if (x === world.park.entranceX && y === world.park.entranceY) color = COLORS.entrance;
      else if (hasPath) color = hasQueue ? COLORS.queue : COLORS.path;
      else if (hasTrack || rideTiles[tile]) color = COLORS.ride;
      else if (scenery === ElementType.LargeScenery) color = COLORS.largeScenery;
      else if (scenery === ElementType.SmallScenery) color = COLORS.smallScenery;

      pixels[pixel] = color[0];
      pixels[pixel + 1] = color[1];
      pixels[pixel + 2] = color[2];
      pixels[pixel + 3] = 255;
    }
  }

  return { width: map.width, height: map.height, pixels };
}

function terrainColor(surface: number): readonly number[] {
  switch (surface) {
    case Surface.Sand:
      return COLORS.sand;
    case Surface.Dirt:
      return COLORS.dirt;
    case Surface.Rock:
      return COLORS.rock;
    default:
      return COLORS.grass;
  }
}

function blend(base: readonly number[], tint: readonly number[], amount: number): number[] {
  return base.map((channel, index) => Math.round(channel * (1 - amount) + tint[index] * amount));
}
