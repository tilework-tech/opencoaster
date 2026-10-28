import { describe, expect, it } from 'vitest';
import { World } from './world';
import { hashWorld } from './hash';

describe('hashWorld', () => {
  it('includes configured guest spawn points', () => {
    const first = new World({ seed: 1, width: 16, height: 16 });
    const second = new World({ seed: 1, width: 16, height: 16 });
    first.park.spawns = [{ x: 0, y: 8 }];
    second.park.spawns = [{ x: 15, y: 8 }];

    expect(hashWorld(first)).not.toBe(hashWorld(second));
  });
});
