import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim/core/simulation';
import type { World } from '../sim/core/world';
import { queueGuests, run } from '../sim/rides/coaster-fixtures';
import { isRideTested } from '../sim/rides/ride-operations';
import { RideResult } from '../sim/rides/ride-results';
import { RideState } from '../sim/rides/ride-store';
import { RideType } from '../sim/rides/ride-types';
import { StaffKind } from '../sim/staff/staff-store';
import { circuitStatus } from '../sim/track/construction';
import { deserialize } from './save';

/**
 * A player's park saved at version 25 (whole-level track heights): a wooden coaster with a
 * four-piece platform and a launched steel looping coaster with a three-piece platform. Neither
 * could be tested, opened or ridden when the park was exported.
 */
const PARK = new URL('./fixtures/bramblewood-hollow-v25.ocsave', import.meta.url);

function loadPark(): { sim: Simulation; wood: number; steel: number } {
  const world: World = deserialize(new Uint8Array(readFileSync(PARK)));
  const rideOfType = (type: RideType): number => {
    for (let slot = 0; slot < world.rides.count; slot++)
      if (
        world.rides.cols.typeId[slot] === type &&
        circuitStatus(world, world.rides.slotToId[slot]).pieces > 0
      )
        return world.rides.slotToId[slot];
    throw new Error(`no track ride of type ${type}`);
  };
  return {
    sim: new Simulation(world),
    wood: rideOfType(RideType.WoodenCoaster),
    steel: rideOfType(RideType.SteelLoopingCoaster),
  };
}

describe("the player's Bramblewood Hollow park", () => {
  it('loads with both coasters as closed circuits with a station', () => {
    const { sim, wood, steel } = loadPark();
    for (const rideId of [wood, steel]) {
      const status = circuitStatus(sim.world, rideId);
      expect(status.closed).toBe(true);
      expect(status.complete).toBe(true);
    }
  });

  it('tests, opens and runs both coasters round full laps with guests aboard', () => {
    const { sim, wood, steel } = loadPark();
    const world = sim.world;
    sim.enqueue({ type: 'hireStaff', kind: StaffKind.Mechanic });
    const slotOf = (rideId: number) => world.rides.idToSlot[rideId];

    for (const rideId of [wood, steel])
      sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
    run(sim, 8000);
    for (const rideId of [wood, steel]) {
      expect(isRideTested(world, rideId)).toBe(true);
      expect(world.rides.cols.state[slotOf(rideId)]).toBe(RideState.Closed);
    }
    expect(world.feedback.code).toBe(RideResult.TestPassed);

    for (const rideId of [wood, steel])
      sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
    sim.step();
    for (const rideId of [wood, steel])
      expect(world.rides.cols.state[slotOf(rideId)]).toBe(RideState.Open);
    queueGuests(sim, steel, 24);
    run(sim, 12_000);

    for (const rideId of [wood, steel]) {
      expect(world.rides.cols.cyclesCompleted[slotOf(rideId)]).toBeGreaterThanOrEqual(1);
      expect(world.rides.cols.guestsServed[slotOf(rideId)]).toBeGreaterThanOrEqual(8);
    }
  }, 120_000);
});
