import type { World } from './world';

/** One unit of per-tick simulation logic. Each sim module exports one or more of these. */
export interface System {
  readonly name: string;
  update(world: World): void;
}
