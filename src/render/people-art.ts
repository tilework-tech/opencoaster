import { rotateDirection } from './projection';
import type { Rotation } from './projection';

export function peopleSpriteKey(kind: number, direction: number, rotation: Rotation): string {
  const view = rotateDirection(direction, rotation);
  return `people/staff/${kind}/direction-${view}`;
}

export function walkingFrame(tick: number): number {
  return (Math.floor(tick / 6) & 3) >>> 0;
}
