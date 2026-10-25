import { RideType } from '../../src/sim/rides/ride-types';
import { buildCircuit, createCoaster, flatOwnedSim, run } from '../../src/sim/rides/coaster-fixtures';
import { PieceMode } from '../../src/sim/track/track-types';
import { serialize } from '../../src/save/save';

const N = PieceMode.Normal;
const L = PieceMode.ChainLift;
const rep = (n: number, name: string, mode = N): Array<[string, PieceMode]> =>
  Array.from({ length: n }, () => [name, mode]);

/**
 * A closed steel looping coaster with a lift, vertical loop, banked medium turns, a drop,
 * a corkscrew, an S-bend and flat small and large turns.
 */
export const STEEL_SHOWCASE: ReadonlyArray<readonly [string, PieceMode]> = [
  ['station', N],
  ['flatToUp25', L],
  ...rep(3, 'up25', L),
  ['up25ToFlat', L],
  ['flat', N],
  ['verticalLoopLeft', N],
  ['flat', N],
  ['flatToRightBank', N],
  ['mediumRightBanked', N],
  ['mediumRightBanked', N],
  ['rightBankToFlat', N],
  ['flatToDown25', N],
  ...rep(3, 'down25'),
  ['down25ToFlat', N],
  ['corkscrewRight', N],
  ['sBendLeft', N],
  ['smallRight', N],
  ['largeRight', N],
  ...rep(4, 'flat'),
];

/** Save file bytes of a 48x48 park holding the showcase coaster, tested and running. */
export function steelShowcaseSave(): Uint8Array {
  const sim = flatOwnedSim(1);
  const rideId = createCoaster(sim, RideType.SteelLoopingCoaster, 20, 10);
  buildCircuit(sim, rideId, STEEL_SHOWCASE);
  sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
  run(sim, 600);
  return serialize(sim.world);
}
