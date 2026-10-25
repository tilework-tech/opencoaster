import { describe, expect, it } from 'vitest';
import { peopleSpriteKey, walkingFrame } from './people-art';

describe('people sprite selection', () => {
  it('rotates a walking direction with the camera and keeps each kind identifiable', () => {
    expect(peopleSpriteKey(1, 2, 1)).toBe('people/staff/1/direction-3');
  });

  it('advances the walk cycle from the simulation tick', () => {
    expect(walkingFrame(0)).toBe(0);
    expect(walkingFrame(5)).toBe(0);
    expect(walkingFrame(6)).toBe(1);
    expect(walkingFrame(12)).toBe(0);
  });
});
