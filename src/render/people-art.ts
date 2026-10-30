import { rotateDirection } from './projection';
import type { Rotation } from './projection';

export function peopleSpriteKey(kind: number, direction: number, rotation: Rotation): string {
  const view = rotateDirection(direction, rotation);
  return `people/staff/${kind}/direction-${view}`;
}

export function walkingFrame(tick: number): number {
  return (Math.floor(tick / 6) & 3) >>> 0;
}

/** Overlay sprites for a walking guest's balloon, hat and umbrella, in `guestRowDrawnItems` bit order. */
export const CARRIED_SPRITES = [
  'people/carried#0',
  'people/carried#1',
  'people/carried#2',
] as const;
