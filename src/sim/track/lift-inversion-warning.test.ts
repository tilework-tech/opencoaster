import { describe, expect, it } from 'vitest';
import { buildCircuit, createCoaster, flatOwnedSim } from '../rides/coaster-fixtures';
import { RideType } from '../rides/ride-types';
import { FeedbackDomain } from '../core/feedback';
import { PieceMode, TrackResult, TrackWarning } from './track-types';

const N = PieceMode.Normal;
const L = PieceMode.ChainLift;

function lastPlacementFeedback(layout: ReadonlyArray<readonly [string, PieceMode]>) {
  const sim = flatOwnedSim(1);
  const rideId = createCoaster(sim, RideType.SteelLoopingCoaster);
  buildCircuit(sim, rideId, layout);
  return sim.world.feedback.domain === FeedbackDomain.Track ? sim.world.feedback.code : -1;
}

describe('placing an inversion after a chain lift', () => {
  it('warns when a corkscrew is placed straight after the last lift piece', () => {
    const code = lastPlacementFeedback([
      ['station', N],
      ['flatToUp25', L],
      ['up25ToFlat', L],
      ['corkscrewRight', N],
    ]);
    expect(code).toBe(TrackWarning.LiftIntoInversion);
  });

  it('places the piece without a warning when a flat piece sits between lift and inversion', () => {
    const code = lastPlacementFeedback([
      ['station', N],
      ['flatToUp25', L],
      ['up25ToFlat', L],
      ['flat', N],
      ['corkscrewRight', N],
    ]);
    expect(code).toBe(TrackResult.Ok);
  });
});
