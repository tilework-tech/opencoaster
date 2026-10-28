import { describe, expect, it } from 'vitest';
import { exceedsNauseaLimit, intensityCeilingOf } from './preferences';

describe('ride tolerance', () => {
  it('caps the preferred intensity band at 10.00 and widens it with happiness', () => {
    expect(intensityCeilingOf(255, 0)).toBe(915);
    expect(intensityCeilingOf(188, 255)).toBe(969);
    expect(intensityCeilingOf(255, 255)).toBe(1170);
  });

  it.each([
    [0, 299, false],
    [0, 301, true],
    [1, 600, false],
    [1, 601, true],
    [2, 800, false],
    [2, 801, true],
    [3, 1000, false],
    [3, 1001, true],
  ])(
    'uses nausea tolerance bucket %i ceiling for ride nausea %i',
    (tolerance, rideNausea, expected) => {
      expect(exceedsNauseaLimit(rideNausea, 0, tolerance)).toBe(expected);
    },
  );

  it('rejects nausea-inducing rides for guests who are already very nauseous', () => {
    expect(exceedsNauseaLimit(140, 161, 3)).toBe(true);
    expect(exceedsNauseaLimit(139, 161, 3)).toBe(false);
    expect(exceedsNauseaLimit(140, 160, 3)).toBe(false);
  });
});
