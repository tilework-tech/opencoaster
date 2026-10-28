import { describe, expect, it } from 'vitest';
import { World } from '../sim/core/world';
import { serialize, deserialize, SAVE_VERSION } from './save';

describe('guest ride history saves', () => {
  it('round trips each guest’s recent ride history', () => {
    const world = new World({ seed: 4, width: 8, height: 8 });
    world.guests.spawn();
    world.guests.cols.rideHistory0[0] = 31;
    world.guests.cols.rideHistory1[0] = 42;

    const restored = deserialize(serialize(world));

    expect(SAVE_VERSION).toBe(32);
    expect(restored.guests.cols.rideHistory0[0]).toBe(31);
    expect(restored.guests.cols.rideHistory1[0]).toBe(42);
  });
});
