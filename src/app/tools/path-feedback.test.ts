import { describe, expect, it } from 'vitest';
import { createFeedback, FeedbackDomain, reportFeedback } from '../../sim/core/feedback';
import { PathResult } from '../../sim/map/paths';
import { pathRejectionFrom, pathTipShouldShow } from './path-feedback';

describe('pathTipShouldShow', () => {
  it('lets the ownership warning replace a stale footpath tooltip', () => {
    expect(pathTipShouldShow(true, true)).toBe(false);
    expect(pathTipShouldShow(true, false)).toBe(true);
    expect(pathTipShouldShow(false, true)).toBe(false);
    expect(pathTipShouldShow(false, false)).toBe(false);
  });
});

describe('pathRejectionFrom', () => {
  it('maps a refused footpath to its tile and a reason', () => {
    const feedback = createFeedback();
    reportFeedback(feedback, FeedbackDomain.Path, PathResult.UnevenGround, 5 * 16 + 3);
    expect(pathRejectionFrom(feedback, 16)).toEqual({
      x: 3,
      y: 5,
      text: 'The ground is too uneven for a footpath. Level it first.',
    });
  });

  it('shows nothing for accepted placements or other feedback domains', () => {
    const accepted = createFeedback();
    reportFeedback(accepted, FeedbackDomain.Path, PathResult.Ok, 0);
    expect(pathRejectionFrom(accepted, 16)).toBeNull();

    const ride = createFeedback();
    reportFeedback(ride, FeedbackDomain.Ride, 3, 1);
    expect(pathRejectionFrom(ride, 16)).toBeNull();
  });

  it('gives every refusal a readable reason', () => {
    for (const code of [
      PathResult.OutOfBounds,
      PathResult.NotOwned,
      PathResult.InvalidPiece,
      PathResult.BelowGround,
      PathResult.Underwater,
      PathResult.UnevenGround,
      PathResult.Blocked,
      PathResult.InsufficientFunds,
    ]) {
      const feedback = createFeedback();
      reportFeedback(feedback, FeedbackDomain.Path, code, 0);
      expect(pathRejectionFrom(feedback, 16)?.text).toMatch(/\S/);
    }
  });
});
