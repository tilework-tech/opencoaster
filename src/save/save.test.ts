import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim/core/simulation';
import { hashWorld } from '../sim/core/hash';
import { deserialize, serialize } from './save';

describe('save', () => {
  it('round-trips world state exactly', () => {
    const sim = new Simulation({ seed: 11, width: 32, height: 32, maxGuests: 500 });
    sim.enqueue({ type: 'spawnGuests', count: 200 });
    for (let i = 0; i < 60; i++) sim.step();
    const loaded = deserialize(serialize(sim.world));
    expect(hashWorld(loaded)).toBe(hashWorld(sim.world));
  });

  it('a loaded world continues identically to the original', () => {
    const a = new Simulation({ seed: 11, width: 32, height: 32, maxGuests: 500 });
    a.enqueue({ type: 'spawnGuests', count: 100 });
    for (let i = 0; i < 30; i++) a.step();
    const b = new Simulation({ seed: 0, width: 1, height: 1 });
    Object.assign(b, { world: deserialize(serialize(a.world)) });
    for (let i = 0; i < 30; i++) {
      a.step();
      b.step();
    }
    expect(hashWorld(b.world)).toBe(hashWorld(a.world));
  });

  it('rejects garbage input', () => {
    expect(() => deserialize(new Uint8Array(32))).toThrow();
  });
});
