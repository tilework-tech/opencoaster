import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { hashWorld } from './hash';

function run(seed: number, ticks: number): number {
  const sim = new Simulation({ seed, width: 64, height: 64, maxGuests: 2000 });
  sim.enqueue({ type: 'spawnGuests', count: 500 });
  sim.enqueue({ type: 'spawnStaff', count: 10, kind: 1 });
  for (let i = 0; i < ticks; i++) sim.step();
  return hashWorld(sim.world);
}

describe('Simulation', () => {
  it('produces identical state for identical seed and commands', () => {
    expect(run(7, 200)).toBe(run(7, 200));
  });

  it('diverges for different seeds', () => {
    expect(run(7, 50)).not.toBe(run(8, 50));
  });

  it('advances the tick counter once per step', () => {
    const sim = new Simulation({ seed: 1, width: 16, height: 16 });
    sim.step();
    sim.step();
    expect(sim.world.tick).toBe(2);
  });

  it('applies commands at the next tick boundary', () => {
    const sim = new Simulation({ seed: 1, width: 16, height: 16, maxGuests: 100 });
    sim.enqueue({ type: 'spawnGuests', count: 5 });
    expect(sim.world.guests.count).toBe(0);
    sim.step();
    expect(sim.world.guests.count).toBe(5);
  });

  it('keeps guests inside the map', () => {
    const sim = new Simulation({ seed: 3, width: 16, height: 16, maxGuests: 100 });
    sim.enqueue({ type: 'spawnGuests', count: 50 });
    for (let i = 0; i < 300; i++) sim.step();
    const { x, y } = sim.world.guests.cols;
    for (let i = 0; i < sim.world.guests.count; i++) {
      expect(x[i]).toBeGreaterThanOrEqual(0);
      expect(x[i]).toBeLessThan(16 * 256);
      expect(y[i]).toBeGreaterThanOrEqual(0);
      expect(y[i]).toBeLessThan(16 * 256);
    }
  });
});
