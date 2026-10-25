export const PREPARED_TERRAIN_MATERIALS = ['grass', 'sand', 'dirt', 'rock'] as const;

export const PREPARED_PROP_SPRITES = [
  'trees/tree-oak',
  'trees/tree-conifer',
  'trees/tree-birch',
  'trees/tree-blossom',
  'trees/tree-autumn',
  'trees/tree-topiary',
  'scenery/shrub',
  'scenery/flower-bed',
  'scenery/wooden-fence',
  'scenery/stone-fence',
  'scenery/bench',
  'scenery/bin',
  'scenery/lamp',
  'scenery/park-entrance',
  'scenery/hedge',
  'scenery/queue-rail',
] as const;

export const PREPARED_UI_SPRITES = ['ui/icons'] as const;

export function preparedSpriteKeys(): string[] {
  return [
    ...PREPARED_PROP_SPRITES,
    ...PREPARED_UI_SPRITES,
    ...PREPARED_TERRAIN_MATERIALS.flatMap((material) => [
      ...Array.from(
        { length: 16 },
        (_, shape) => `terrain/${material}/shape-${shape.toString(16).padStart(2, '0')}`,
      ),
      `terrain/${material}/surface`,
      ...Array.from({ length: 4 }, (_, direction) => `terrain/${material}/cliff-face-${direction}`),
    ]),
  ];
}
