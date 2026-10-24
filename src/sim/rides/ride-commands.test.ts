import { describe, expect, it } from 'vitest';
import { placePath } from '../map/paths';
import { flatWorld } from '../integration/fixtures';
import { createRide } from './ride-operations';
import { applyRideCommand } from './ride-commands';
import type { RideCommand } from './ride-commands';
import { RideType } from './ride-types';
import { RideResult } from './ride-results';

describe('ride commands', () => {
  it('opens a flat ride when its queue is connected after entrance and exit placement', () => {
    const world = flatWorld(16, 17);
    const rideId = createRide(world, RideType.MerryGoRound, 4, 4);
    const apply = (command: RideCommand) => applyRideCommand(world, command);

    expect(apply({ type: 'placeRideEntrance', rideId, x: 4, y: 5 })).toBe(RideResult.Ok);
    expect(apply({ type: 'placeRideExit', rideId, x: 5, y: 4 })).toBe(RideResult.Ok);
    expect(placePath(world.map, { x: 3, y: 5, queue: true })).toBe(true);
    expect(placePath(world.map, { x: 2, y: 5 })).toBe(true);
    expect(apply({ type: 'setRideStatus', rideId, status: 'open' })).toBe(RideResult.Ok);
  });
});
