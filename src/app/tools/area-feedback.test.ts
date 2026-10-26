import { describe, expect, it } from 'vitest';
import { LandResult } from '../../sim/map/land-tool';
import type { AreaPlan } from '../../sim/map/area-tools';
import { areaPreviewText } from './area-feedback';

function plan(result: LandResult, tiles: number, costCents: number): AreaPlan {
  return {
    result,
    subject: -1,
    costCents,
    selected: new Int32Array(0),
    tiles: new Int32Array(tiles),
    level: 3,
    removed: 0,
  };
}

describe('water preview text', () => {
  it('shows the flooded tile count and the price', () => {
    expect(areaPreviewText('water', false, plan(LandResult.Ok, 9, 2250))).toBe(
      'Raise water, 9 tiles: $22.50',
    );
    expect(areaPreviewText('water', true, plan(LandResult.Ok, 1, 250))).toBe(
      'Lower water, 1 tile: $2.50',
    );
  });

  it('gives the reason a step is refused', () => {
    expect(areaPreviewText('water', false, plan(LandResult.WaterSpills, 0, 0))).toContain(
      'spill over the bank',
    );
    expect(areaPreviewText('water', false, plan(LandResult.PathInTheWay, 0, 0))).toBe(
      'Footpath in the way.',
    );
  });
});
