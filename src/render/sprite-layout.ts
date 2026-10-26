/** On-screen sprite boxes, in world pixels, shared by every renderer so backends draw identical scenes. */
export interface SpriteBox {
  width: number;
  height: number;
}

export const AMBIENT_TREE_BOX: SpriteBox = { width: 34, height: 44 };
/**
 * A flower bed fills its whole tile footprint and is anchored at the projected tile centre.
 */
export const FLOWER_BED_BOX: SpriteBox = { width: 64, height: 40 };
export const PARK_GATE_BOX: SpriteBox = { width: 46, height: 40 };
/** Guest fallback and visibility bounds around the compact native walking sprite. */
export const GUEST_BOX: SpriteBox = { width: 20, height: 24 };
export const STAFF_BOX: SpriteBox = { width: 11, height: 13 };
/** Placeable scenery is drawn this many pixels tall per catalog height unit. */
export const SCENERY_PIXELS_PER_HEIGHT = 12;
