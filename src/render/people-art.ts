import type { Rotation } from './projection';

export type PersonKind = 'guest' | 'staff';

export function peopleSpriteKey(
  kind: number,
  direction: number,
  rotation: Rotation,
  person: PersonKind,
): string {
  const view = (((direction + rotation) % 4) + 4) % 4;
  return `people/${person}/${kind}/direction-${view}`;
}

export function walkingFrame(tick: number): number {
  return (Math.floor(tick / 6) & 1) >>> 0;
}
