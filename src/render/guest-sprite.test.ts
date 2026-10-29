import { describe, expect, it } from 'vitest';
import { guestSpriteName } from './webgl2-renderer';
import { createSnapshot, guestRowSeated, writeSnapshot } from '../worker/snapshot';
import { GuestState } from '../sim/guests/guest-store';
import { createGuestSystem } from '../sim/guests/guest-system';
import { PathAddition, setPathAddition } from '../sim/map/paths';
import { rotateDirection } from './projection';
import type { Rotation } from './projection';
import { flatWorld, guestAt, layPath, row } from '../sim/integration/fixtures';

const system = createGuestSystem(() => ({ parkRating: 0, entranceFee: 0 }));

function benchPark() {
  const w = flatWorld(16, 9);
  layPath(w, row(6, 4, 8));
  layPath(w, [[6, 7]]);
  setPathAddition(w.map, 6, 6, PathAddition.Bench);
  const guest = guestAt(w, 6, 6);
  w.guests.cols.energy[guest] = 62;
  w.guests.cols.tint[guest] = 3;
  return { w, guest };
}

function snapshotWord(w: ReturnType<typeof flatWorld>, guest: number): number {
  const snapshot = createSnapshot({ guests: 4, staff: 0, vehicles: 0, litter: 0 });
  writeSnapshot(w, snapshot);
  return snapshot.guests.data[guest * 4 + 3]!;
}

describe('guest sprite choice', () => {
  it('shows the sitting figure only once the guest is on its seat, facing the path in every view', () => {
    const { w, guest } = benchPark();
    let walkedToSeat = false;
    let sawWalkingWhileApproaching = false;
    for (let i = 0; i < 800; i++) {
      system.update(w);
      w.tick++;
      if (w.guests.cols.state[guest] !== GuestState.Sitting) continue;
      const word = snapshotWord(w, guest);
      if (!guestRowSeated(word)) {
        sawWalkingWhileApproaching = true;
        expect(guestSpriteName(word, w.tick, 0)).toMatch(/^people\/guest-walk#/);
      } else {
        walkedToSeat = true;
        break;
      }
    }
    expect(sawWalkingWhileApproaching).toBe(true);
    expect(walkedToSeat).toBe(true);

    const word = snapshotWord(w, guest);
    const facing = w.guests.cols.heading[guest]!;
    const names = [0, 1, 2, 3].map((rotation) =>
      guestSpriteName(word, w.tick, rotation as Rotation),
    );
    for (const [rotation, name] of names.entries()) {
      expect(name).toMatch(/^people\/guest-sit#/);
      expect(Number(name.split('#')[1]) % 4).toBe(rotateDirection(facing, rotation as Rotation));
    }
    expect(new Set(names).size).toBe(4);
  });
});
