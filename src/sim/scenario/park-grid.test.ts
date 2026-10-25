import { describe, expect, it } from 'vitest';
import { ParkGrid, rideFrontage } from './park-grid';
import type { EntranceSide } from './scenario';

describe('park grid', () => {
  it('runs rows inward from the gate on every side', () => {
    const inward: Record<EntranceSide, [number, number]> = {
      north: [0, 1],
      south: [0, -1],
      east: [-1, 0],
      west: [1, 0],
    };
    for (const side of ['north', 'south', 'east', 'west'] as const) {
      const grid = new ParkGrid(20, 30, side);
      expect(grid.tile(0, 0)).toEqual([20, 30]);
      const [dx, dy] = inward[side];
      expect(grid.tile(5, 0)).toEqual([20 + dx * 5, 30 + dy * 5]);
    }
  });

  it('puts positive lateral on the same side of the spine for a given gate', () => {
    const grid = new ParkGrid(20, 30, 'south');
    expect(grid.tile(3, 2)).toEqual([22, 27]);
    expect(grid.tile(3, -2)).toEqual([18, 27]);
  });
});

describe('ride frontage', () => {
  it('queues from the spine to the entrance and exits one row nearer the gate', () => {
    const grid = new ParkGrid(20, 30, 'south');
    const f = rideFrontage(grid, 6, 4);
    expect(f.ride).toEqual([24, 24]);
    expect(f.entrance).toEqual([23, 24]);
    expect(f.queue).toEqual([
      [21, 24],
      [22, 24],
      [23, 24],
    ]);
    expect(f.exit).toEqual([24, 25]);
    expect(f.exitPath).toEqual([
      [21, 25],
      [22, 25],
      [23, 25],
      [24, 25],
    ]);
  });

  it('mirrors for the negative side', () => {
    const grid = new ParkGrid(20, 30, 'south');
    const f = rideFrontage(grid, 6, -2);
    expect(f.ride).toEqual([18, 24]);
    expect(f.entrance).toEqual([19, 24]);
    expect(f.queue).toEqual([[19, 24]]);
  });
});
