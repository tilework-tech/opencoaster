import { ElementType, MAX_ELEMENT_BASE, OWNED, RIGHTS_OWNED } from './tile-map';
import type { TileMap } from './tile-map';
import { markPathsChanged } from '../pathfinding/graph';

export const enum SceneryCategory {
  Trees = 'trees',
  Shrubs = 'shrubs',
  Gardens = 'gardens',
  Fences = 'fences',
  Rocks = 'rocks',
  Features = 'features',
  Themed = 'themed',
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
  SunflowerPatch = 13,
  LavenderRows = 14,
  RoseArch = 15,
  FlowerUrn = 16,
  PlanterBox = 17,
  Boulder = 18,
  RockCluster = 19,
  FallenLog = 20,
  TreeStump = 21,
  ReedClump = 22,
  TieredFountain = 23,
  JetFountain = 24,
  GardenStatue = 25,
  Obelisk = 26,
  Sundial = 27,
  SignBoard = 28,
  Flagpole = 29,
  Scarecrow = 30,
  WishingWell = 31,
}

export interface SceneryDefinition {
  name: string;
  sprite: string;
  category: SceneryCategory;
  priceCents: number;
  removalPriceCents: number;
  height: number;
  width: number;
  /** One-line description shown as the menu tooltip. */
  blurb: string;
  /**
   * Drawn from its own four-view model sprite `scenery/<sprite>/view-<n>` at native pixel size,
   * rather than stretched into the catalog box.
   */
  native?: true;
  /** The placement rotation turns the model; otherwise the piece looks the same at every rotation. */
  directional?: true;
}

export interface SceneryGroup {
  category: SceneryCategory;
  label: string;
}

/** Menu groups in browse order. */
export const SCENERY_GROUPS: readonly SceneryGroup[] = [
  { category: SceneryCategory.Trees, label: 'Trees' },
  { category: SceneryCategory.Shrubs, label: 'Shrubs and ornaments' },
  { category: SceneryCategory.Gardens, label: 'Flowers and planting' },
  { category: SceneryCategory.Rocks, label: 'Rocks and nature' },
  { category: SceneryCategory.Features, label: 'Fountains and statues' },
  { category: SceneryCategory.Themed, label: 'Themed decorations' },
  { category: SceneryCategory.Fences, label: 'Fences and walls' },
];

export const SCENERY_CATALOG: readonly SceneryDefinition[] = [
  {
    name: 'Oak tree',
    blurb: 'A broad-crowned shade tree.',
    sprite: 'tree-oak',
    category: SceneryCategory.Trees,
    priceCents: 150,
    removalPriceCents: 25,
    height: 3,
    width: 36,
  },
  {
    name: 'Conifer',
    blurb: 'A tall evergreen with a dark cone of needles.',
    sprite: 'tree-conifer',
    category: SceneryCategory.Trees,
    priceCents: 175,
    removalPriceCents: 25,
    height: 4,
    width: 34,
  },
  {
    name: 'Blossom tree',
    blurb: 'A spring tree covered in pink blossom.',
    sprite: 'tree-blossom',
    category: SceneryCategory.Trees,
    priceCents: 200,
    removalPriceCents: 25,
    height: 3,
    width: 36,
  },
  {
    name: 'Shrub',
    blurb: 'A low, leafy bush.',
    sprite: 'shrub',
    category: SceneryCategory.Shrubs,
    priceCents: 50,
    removalPriceCents: 10,
    height: 1,
    width: 32,
  },
  {
    name: 'Flower bed',
    blurb: 'A raised bed of bright flowers that follows the slope.',
    sprite: 'flower-bed',
    category: SceneryCategory.Gardens,
    priceCents: 75,
    removalPriceCents: 10,
    height: 1,
    width: 30,
  },
  {
    name: 'Hedge',
    blurb: 'A clipped hedge along one tile edge.',
    sprite: 'hedge',
    category: SceneryCategory.Shrubs,
    priceCents: 100,
    removalPriceCents: 15,
    height: 2,
    width: 34,
  },
  {
    name: 'Wooden fence',
    blurb: 'A timber fence along one tile edge.',
    sprite: 'wooden-fence',
    category: SceneryCategory.Fences,
    priceCents: 60,
    removalPriceCents: 0,
    height: 2,
    width: 38,
  },
  {
    name: 'Stone fence',
    blurb: 'A low stone wall along one tile edge.',
    sprite: 'stone-fence',
    category: SceneryCategory.Fences,
    priceCents: 90,
    removalPriceCents: 0,
    height: 2,
    width: 38,
  },
  {
    name: 'Birch',
    blurb: 'A slim tree with pale bark.',
    sprite: 'tree-birch',
    category: SceneryCategory.Trees,
    priceCents: 150,
    removalPriceCents: 25,
    height: 4,
    width: 30,
  },
  {
    name: 'Autumn tree',
    blurb: 'A tree in red and gold leaves.',
    sprite: 'tree-autumn',
    category: SceneryCategory.Trees,
    priceCents: 175,
    removalPriceCents: 25,
    height: 3,
    width: 36,
  },
  {
    name: 'Topiary',
    blurb: 'A neatly clipped ornamental tree.',
    sprite: 'tree-topiary',
    category: SceneryCategory.Trees,
    priceCents: 225,
    removalPriceCents: 25,
    height: 3,
    width: 30,
  },
  {
    name: 'Palm tree',
    blurb: 'A leaning palm with a crown of fronds.',
    sprite: 'tree-palm',
    category: SceneryCategory.Trees,
    priceCents: 250,
    removalPriceCents: 25,
    height: 4,
    width: 36,
  },
  {
    name: 'Cactus',
    blurb: 'A tall desert cactus with two arms.',
    sprite: 'tree-cactus',
    category: SceneryCategory.Trees,
    priceCents: 125,
    removalPriceCents: 15,
    height: 2,
    width: 24,
  },
  {
    name: 'Sunflower patch',
    blurb: 'Tall sunflowers nodding over a patch of soil.',
    sprite: 'sunflower-patch',
    category: SceneryCategory.Gardens,
    priceCents: 200,
    removalPriceCents: 20,
    height: 3,
    width: 52,
    native: true,
  },
  {
    name: 'Lavender rows',
    blurb: 'Three rows of purple lavender spikes.',
    sprite: 'lavender-rows',
    category: SceneryCategory.Gardens,
    priceCents: 120,
    removalPriceCents: 15,
    height: 1,
    width: 56,
    native: true,
    directional: true,
  },
  {
    name: 'Rose arch',
    blurb: 'A timber arch wrapped in climbing roses.',
    sprite: 'rose-arch',
    category: SceneryCategory.Gardens,
    priceCents: 325,
    removalPriceCents: 30,
    height: 3,
    width: 34,
    native: true,
    directional: true,
  },
  {
    name: 'Flower urn',
    blurb: 'A stone urn spilling over with flowers.',
    sprite: 'flower-urn',
    category: SceneryCategory.Gardens,
    priceCents: 150,
    removalPriceCents: 15,
    height: 2,
    width: 30,
    native: true,
  },
  {
    name: 'Planter box',
    blurb: 'A timber box of tulips and daisies.',
    sprite: 'planter-box',
    category: SceneryCategory.Gardens,
    priceCents: 90,
    removalPriceCents: 10,
    height: 2,
    width: 38,
    native: true,
    directional: true,
  },
  {
    name: 'Boulder',
    blurb: 'One large weathered boulder.',
    sprite: 'boulder',
    category: SceneryCategory.Rocks,
    priceCents: 100,
    removalPriceCents: 20,
    height: 2,
    width: 40,
    native: true,
  },
  {
    name: 'Rock cluster',
    blurb: 'Three rocks of different sizes grouped together.',
    sprite: 'rock-cluster',
    category: SceneryCategory.Rocks,
    priceCents: 85,
    removalPriceCents: 15,
    height: 1,
    width: 48,
    native: true,
  },
  {
    name: 'Fallen log',
    blurb: 'A mossy log lying on the ground.',
    sprite: 'fallen-log',
    category: SceneryCategory.Rocks,
    priceCents: 70,
    removalPriceCents: 10,
    height: 2,
    width: 44,
    native: true,
    directional: true,
  },
  {
    name: 'Tree stump',
    blurb: 'A sawn stump with spreading roots.',
    sprite: 'tree-stump',
    category: SceneryCategory.Rocks,
    priceCents: 55,
    removalPriceCents: 10,
    height: 1,
    width: 38,
    native: true,
  },
  {
    name: 'Reed clump',
    blurb: 'Tall wild reeds with brown seed heads.',
    sprite: 'reed-clump',
    category: SceneryCategory.Rocks,
    priceCents: 65,
    removalPriceCents: 10,
    height: 3,
    width: 42,
    native: true,
  },
  {
    name: 'Tiered fountain',
    blurb: 'A two-bowl stone fountain with falling water.',
    sprite: 'tiered-fountain',
    category: SceneryCategory.Features,
    priceCents: 650,
    removalPriceCents: 60,
    height: 3,
    width: 44,
    native: true,
  },
  {
    name: 'Jet fountain',
    blurb: 'A wide, low basin with a central water jet.',
    sprite: 'jet-fountain',
    category: SceneryCategory.Features,
    priceCents: 500,
    removalPriceCents: 50,
    height: 2,
    width: 48,
    native: true,
  },
  {
    name: 'Garden statue',
    blurb: 'A marble figure raising an arm on a stone plinth.',
    sprite: 'garden-statue',
    category: SceneryCategory.Features,
    priceCents: 450,
    removalPriceCents: 40,
    height: 3,
    width: 38,
    native: true,
    directional: true,
  },
  {
    name: 'Obelisk',
    blurb: 'A tapering stone obelisk on a square base.',
    sprite: 'obelisk',
    category: SceneryCategory.Features,
    priceCents: 375,
    removalPriceCents: 35,
    height: 3,
    width: 24,
    native: true,
  },
  {
    name: 'Sundial',
    blurb: 'A brass sundial on a stone pedestal.',
    sprite: 'sundial',
    category: SceneryCategory.Features,
    priceCents: 250,
    removalPriceCents: 25,
    height: 2,
    width: 30,
    native: true,
    directional: true,
  },
  {
    name: 'Park signboard',
    blurb: 'A striped signboard on two posts.',
    sprite: 'park-signboard',
    category: SceneryCategory.Themed,
    priceCents: 175,
    removalPriceCents: 15,
    height: 3,
    width: 36,
    native: true,
    directional: true,
  },
  {
    name: 'Flagpole',
    blurb: 'A tall pole flying a striped flag.',
    sprite: 'flagpole',
    category: SceneryCategory.Themed,
    priceCents: 200,
    removalPriceCents: 20,
    height: 6,
    width: 32,
    native: true,
    directional: true,
  },
  {
    name: 'Scarecrow',
    blurb: 'A straw-stuffed scarecrow in a floppy hat.',
    sprite: 'scarecrow',
    category: SceneryCategory.Themed,
    priceCents: 140,
    removalPriceCents: 15,
    height: 3,
    width: 40,
    native: true,
    directional: true,
  },
  {
    name: 'Wishing well',
    blurb: 'A stone well under a little timber roof.',
    sprite: 'wishing-well',
    category: SceneryCategory.Themed,
    priceCents: 425,
    removalPriceCents: 40,
    height: 3,
    width: 52,
    native: true,
    directional: true,
  },
];

/** Whether the item is a tree, which a scenario may forbid removing. */
export function isTreeScenery(item: SceneryItem): boolean {
  return SCENERY_CATALOG[item]?.category === SceneryCategory.Trees;
}

export function isWallScenery(item: SceneryItem): boolean {
  return (
    item === SceneryItem.Hedge ||
    item === SceneryItem.WoodenFence ||
    item === SceneryItem.StoneFence
  );
}

/** Why a scenery item cannot be placed on a tile; `Ok` means it can. */
export const enum SceneryResult {
  Ok = 0,
  Invalid = 1,
  NotOwned = 2,
  Underwater = 3,
  Blocked = 4,
  InsufficientFunds = 5,
  /** The item would rise above the scenario's construction height cap. */
  HeightLimit = 6,
}

/** Checks a placement without changing the map: the same rules `placeScenery` applies. */
export function sceneryPlacementResult(
  map: TileMap,
  x: number,
  y: number,
  item: SceneryItem,
  rotation = 0,
): SceneryResult {
  const definition = SCENERY_CATALOG[item];
  if (
    !definition ||
    !map.inBounds(x, y) ||
    !Number.isInteger(rotation) ||
    rotation < 0 ||
    rotation > 3
  )
    return SceneryResult.Invalid;
  const tile = map.index(x, y);
  if ((map.ownership[tile] & (OWNED | RIGHTS_OWNED)) === 0) return SceneryResult.NotOwned;
  if (map.waterLevel[tile] > map.heights[tile]) return SceneryResult.Underwater;
  const base = map.heights[tile] + (map.slope[tile] ? 1 : 0);
  const clear = Math.min(MAX_ELEMENT_BASE, base + Math.max(1, definition.height));
  for (let element = map.firstElement(tile); element >= 0; element = map.nextElement(element)) {
    if (isWallScenery(item)) {
      if (map.elType[element] === ElementType.SmallScenery) {
        const otherItem = map.elData[element] as SceneryItem;
        if (isWallScenery(otherItem)) {
          if (map.elFlags[element] === rotation) return SceneryResult.Blocked;
          continue;
        }
      }
      if (map.elType[element] === ElementType.Path) continue;
    }
    if (map.elBase[element] < clear && base < map.elClear[element]) return SceneryResult.Blocked;
  }
  return SceneryResult.Ok;
}

export function placeScenery(
  map: TileMap,
  x: number,
  y: number,
  item: SceneryItem,
  rotation = 0,
): boolean {
  if (sceneryPlacementResult(map, x, y, item, rotation) !== SceneryResult.Ok) return false;
  const tile = map.index(x, y);
  const base = map.heights[tile] + (map.slope[tile] ? 1 : 0);
  const clear = Math.min(MAX_ELEMENT_BASE, base + Math.max(1, SCENERY_CATALOG[item]!.height));
  const element = map.addElement(tile, ElementType.SmallScenery, base, clear, rotation, item);
  if (element >= 0 && isWallScenery(item)) markPathsChanged(map);
  return element >= 0;
}

export function removeScenery(
  map: TileMap,
  x: number,
  y: number,
  edge?: number,
  keepTrees = false,
): SceneryItem | null {
  if (!map.inBounds(x, y)) return null;
  const tile = map.index(x, y);
  if ((map.ownership[tile] & (OWNED | RIGHTS_OWNED)) === 0) return null;
  for (let element = map.firstElement(tile); element >= 0; element = map.nextElement(element)) {
    if (map.elType[element] !== ElementType.SmallScenery) continue;
    const item = map.elData[element] as SceneryItem;
    if (keepTrees && isTreeScenery(item)) continue;
    if (isWallScenery(item) && edge !== undefined && map.elFlags[element] !== edge) continue;
    if (!isWallScenery(item) && edge !== undefined) continue;
    map.removeElement(tile, element);
    if (isWallScenery(item)) markPathsChanged(map);
    return SCENERY_CATALOG[item] ? item : null;
  }
  return null;
}
