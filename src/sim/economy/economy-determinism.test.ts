import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { hashWorld } from '../core/hash';
import { TICKS_PER_MONTH } from './calendar';
import { findScenario } from '../scenario/catalog';
import { applyScenario } from '../scenario/scenario';
import { Funding } from '../research/research';
import { createRide } from '../rides/ride-operations';
import { RideType } from '../rides/ride-types';

/** Starter scenario, a funded research programme and a targeted campaign, run for two months. */
function replay(options: {
  seed: number;
  difficultRating?: boolean;
  campaignTargetIndex?: number;
}): number {
  const starter = findScenario('starter');
  if (!starter) throw new Error('starter scenario missing');
  const s = new Simulation({
    seed: options.seed,
    width: starter.mapWidth,
    height: starter.mapHeight,
  });
  applyScenario(s.world, {
    ...starter,
    difficultRating: options.difficultRating ?? starter.difficultRating,
  });
  const rides = [
    createRide(s.world, RideType.MerryGoRound, 4, 4),
    createRide(s.world, RideType.MerryGoRound, 8, 8),
  ];
  s.enqueue({ type: 'research', action: { type: 'setFunding', level: Funding.Normal } });
  s.enqueue({ type: 'research', action: { type: 'setCategories', mask: 0xffffffff } });
  s.enqueue({ type: 'research', action: { type: 'setPriority', itemIds: [] } });
  s.enqueue({
    type: 'economy',
    action: {
      type: 'startCampaign',
      campaignId: 2,
      weeks: 4,
      targetId: rides[options.campaignTargetIndex ?? 0],
    },
  });
  for (let t = 0; t < 2 * TICKS_PER_MONTH; t++) s.step();
  return hashWorld(s.world);
}

describe('economy fidelity determinism', () => {
  it('gives the same hash for the same seed and command stream', () => {
    expect(replay({ seed: 2026 })).toBe(replay({ seed: 2026 }));
  });

  it('hashes the difficult-rating flag and the campaign target', () => {
    const base = replay({ seed: 2026 });
    expect(replay({ seed: 2026, difficultRating: true })).not.toBe(base);
    expect(replay({ seed: 2026, campaignTargetIndex: 1 })).not.toBe(base);
  });
});
