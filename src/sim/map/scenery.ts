import { ElementType, MAX_ELEMENT_BASE, OWNED, RIGHTS_OWNED } from './tile-map';
import type { TileMap } from './tile-map';

export const enum SceneryCategory {
  Trees = 'trees',
  Shrubs = 'shrubs',
  Gardens = 'gardens',
  Fences = 'fences',
}

export const enum SceneryItem {
  OakTree = 0,
  Conifer = 1,
  BlossomTree = 2,
  Shrub = 3,
  FlowerBed = 4,
  Hedge = 5,
  WoodenFence = 6,
  StoneFence = 7,
  BirchTree = 8,
  AutumnTree = 9,
  TopiaryTree = 10,
  PalmTree = 11,
  CactusTree = 12,
}

export interface SceneryDefinition {
  name: string;
  sprite: string;
  category: SceneryCategory;
  priceCents: number;
  removalPriceCents: number;
  height: number;
  width: number;
}

export const SCENERY_CATALOG: readonly SceneryDefinition[] = [
  {
    name: 'Oak tree',
    sprite: 'tree-oak',
    category: SceneryCategory.Trees,
    priceCents: 150,
    removalPriceCents: 25,
    height: 3,
    width: 36,
  },
  {
    name: 'Conifer',
    sprite: 'tree-conifer',
    category: SceneryCategory.Trees,
    priceCents: 175,
    removalPriceCents: 25,
    height: 4,
    width: 34,
  },
  {
    name: 'Blossom tree',
    sprite: 'tree-blossom',
    category: SceneryCategory.Trees,
    priceCents: 200,
    removalPriceCents: 25,
    height: 3,
    width: 36,
  },
  {
    name: 'Shrub',
    sprite: 'shrub',
    category: SceneryCategory.Shrubs,
    priceCents: 50,
    removalPriceCents: 10,
    height: 1,
    width: 26,
  },
  {
    name: 'Flower bed',
    sprite: 'flower-bed',
    category: SceneryCategory.Gardens,
    priceCents: 75,
    removalPriceCents: 10,
    height: 1,
    width: 30,
  },
  {
    name: 'Hedge',
    sprite: 'hedge',
    category: SceneryCategory.Shrubs,
    priceCents: 100,
    removalPriceCents: 15,
    height: 2,
    width: 34,
  },
  {
    name: 'Wooden fence',
    sprite: 'wooden-fence',
    category: SceneryCategory.Fences,
    priceCents: 60,
    removalPriceCents: 0,
    height: 2,
    width: 38,
  },
  {
    name: 'Stone fence',
    sprite: 'stone-fence',
    category: SceneryCategory.Fences,
    priceCents: 90,
    removalPriceCents: 0,
    height: 2,
    width: 38,
  },
  {
    name: 'Birch',
    sprite: 'tree-birch',
    category: SceneryCategory.Trees,
    priceCents: 150,
    removalPriceCents: 25,
    height: 4,
    width: 30,
  },
  {
    name: 'Autumn tree',
    sprite: 'tree-autumn',
    category: SceneryCategory.Trees,
    priceCents: 175,
    removalPriceCents: 25,
    height: 3,
    width: 36,
  },
  {
    name: 'Topiary',
    sprite: 'tree-topiary',
    category: SceneryCategory.Trees,
    priceCents: 225,
    removalPriceCents: 25,
    height: 3,
    width: 30,
  },
  {
    name: 'Palm tree',
    sprite: 'tree-palm',
    category: SceneryCategory.Trees,
    priceCents: 250,
    removalPriceCents: 25,
    height: 4,
    width: 36,
  },
  {
    name: 'Cactus',
    sprite: 'tree-cactus',
    category: SceneryCategory.Trees,
    priceCents: 125,
    removalPriceCents: 15,
    height: 2,
    width: 24,
  },
];

export function placeScenery(
  map: TileMap,
  x: number,
  y: number,
  item: SceneryItem,
  rotation = 0,
): boolean {
  const definition = SCENERY_CATALOG[item];
  if (
    !definition ||
    !map.inBounds(x, y) ||
    !Number.isInteger(rotation) ||
    rotation < 0 ||
    rotation > 3
  )
    return false;
  const tile = map.index(x, y);
  if (
    (map.ownership[tile] & (OWNED | RIGHTS_OWNED)) === 0 ||
    map.waterLevel[tile] > map.heights[tile]
  )
    return false;
  const base = map.heights[tile] + (map.slope[tile] ? 1 : 0);
  const clear = Math.min(MAX_ELEMENT_BASE, base + Math.max(1, definition.height));
  for (let element = map.firstElement(tile); element >= 0; element = map.nextElement(element)) {
    if (map.elBase[element] < clear && base < map.elClear[element]) return false;
  }
  const element = map.addElement(tile, ElementType.SmallScenery, base, clear, rotation, item);
  return element >= 0;
}

export function removeScenery(map: TileMap, x: number, y: number): SceneryItem | null {
  if (!map.inBounds(x, y)) return null;
  const tile = map.index(x, y);
  if ((map.ownership[tile] & (OWNED | RIGHTS_OWNED)) === 0) return null;
  for (let element = map.firstElement(tile); element >= 0; element = map.nextElement(element)) {
    if (map.elType[element] !== ElementType.SmallScenery) continue;
    const item = map.elData[element] as SceneryItem;
    map.removeElement(tile, element);
    return SCENERY_CATALOG[item] ? item : null;
  }
  return null;
}
