export type RideCategory =
  'gentle' | 'thrill' | 'coaster' | 'water' | 'shop' | 'stall' | 'facility';

/** Static, data-driven ride type definition (loaded from JSON/TS data, never from the store). */
export interface RideTypeDef {
  id: number;
  name: string;
  category: RideCategory;
  /** Build cost in cents. */
  cost: number;
  footprint: ReadonlyArray<readonly [dx: number, dy: number]>;
  /** Whether the layout comes from the track editor (track module) or a fixed footprint. */
  usesTrack: boolean;
}
