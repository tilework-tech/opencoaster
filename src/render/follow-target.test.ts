import { addSpawnAtCorner } from '../sim/integration/fixtures';
import { describe, expect, it } from 'vitest';
import { World } from '../sim/core/world';
import { spawnGuest } from '../sim/guests/guest-store';
import { createRide } from '../sim/rides/ride-operations';
import { RideType } from '../sim/rides/ride-types';
import { StaffKind, spawnStaff } from '../sim/staff/staff-store';
import { createSnapshot, writeSnapshot } from '../worker/snapshot';
import { project } from './projection';
import { resolveFollowTarget } from './follow-target';
import { cameraForFollowPosition } from './follow-target';
import type { FollowTarget } from './follow-target';

function park() {
  const world = new World({ seed: 11, width: 20, height: 20, maxGuests: 2 });
  addSpawnAtCorner(world);
  spawnGuest(world);
  spawnGuest(world);
  spawnStaff(world, StaffKind.Mechanic);
  const rideId = createRide(world, RideType.FerrisWheel, 6, 9);
  world.guests.cols.x[1] = 900;
  world.guests.cols.y[1] = 1100;
  world.guests.cols.z[1] = 0;
  world.staff.cols.x[0] = 640;
  world.staff.cols.y[0] = 896;
  world.staff.cols.z[0] = 128;
  const snapshot = createSnapshot({
    guests: 2,
    staff: 1,
    rides: 1,
    vehicles: 0,
    litter: 0,
    mapTiles: 400,
  });
  writeSnapshot(world, snapshot);
  return {
    world,
    snapshot,
    guestId: world.guests.slotToId[1]!,
    staffId: world.staff.slotToId[0]!,
    rideId,
  };
}

describe('viewport follow targets', () => {
  it('centres its camera on the projected target at a close-up zoom', () => {
    const camera = cameraForFollowPosition({ x: 900, y: 1100, z: 128 }, 12, 10, 2);
    const expected = new Float64Array(2);
    project(900, 1100, 128, 12, 10, 0, expected);

    expect(camera.x).toBe(expected[0]);
    expect(camera.y).toBe(expected[1]);
    expect(camera.zoom).toBe(2);
  });

  it('follows a guest by stable id as the guest moves between snapshots', () => {
    const { world, snapshot: first, guestId } = park();
    const target: FollowTarget = { kind: 'guest', id: guestId };

    expect(resolveFollowTarget(first, target)).toEqual({ x: 900, y: 1100, z: 0 });

    world.guests.cols.x[1] = 1300;
    writeSnapshot(world, first);
    expect(resolveFollowTarget(first, target)).toEqual({ x: 1300, y: 1100, z: 0 });

    world.guests.despawnId(guestId);
    const gone = createSnapshot({ guests: 2, staff: 1, rides: 1, vehicles: 0, litter: 0 });
    writeSnapshot(world, gone);
    expect(resolveFollowTarget(gone, target)).toBeNull();
  });

  it('follows a staff member using the latest position and elevation', () => {
    const { snapshot: current, staffId } = park();

    expect(resolveFollowTarget(current, { kind: 'staff', id: staffId })).toEqual({
      x: 640,
      y: 896,
      z: 128,
    });
  });

  it('follows a ride at the center of its current anchor tile', () => {
    const { snapshot: current, rideId } = park();

    expect(resolveFollowTarget(current, { kind: 'ride', id: rideId })).toEqual({
      x: 6 * 256 + 128,
      y: 9 * 256 + 128,
      z: 2 * 64,
    });
  });

  it('stops following a target once it is absent from the latest snapshot', () => {
    const current = createSnapshot({ guests: 0, staff: 0, rides: 0, vehicles: 0, litter: 0 });

    expect(resolveFollowTarget(current, { kind: 'guest', id: 41 })).toBeNull();
    expect(resolveFollowTarget(current, { kind: 'staff', id: 17 })).toBeNull();
    expect(resolveFollowTarget(current, { kind: 'ride', id: 8 })).toBeNull();
  });
});
