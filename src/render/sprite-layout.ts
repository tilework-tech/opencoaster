/** On-screen sprite boxes, in world pixels, shared by every renderer so backends draw identical scenes. */
export interface SpriteBox {
  width: number;
  height: number;
}

export const AMBIENT_TREE_BOX: SpriteBox = { width: 34, height: 44 };
export const FLOWER_BED_BOX: SpriteBox = { width: 30, height: 12 };
export const PARK_GATE_BOX: SpriteBox = { width: 46, height: 40 };
export const GUEST_BOX: SpriteBox = { width: 7, height: 9 };
export const STAFF_BOX: SpriteBox = { width: 11, height: 13 };
/** Placeable scenery is drawn this many pixels tall per catalog height unit. */
export const SCENERY_PIXELS_PER_HEIGHT = 12;
