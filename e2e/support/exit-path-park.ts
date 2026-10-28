import { World } from '../../src/sim/core/world';
import { serialize } from '../../src/save/save';
import { layPath, prepareFlat, row } from '../../src/sim/integration/fixtures';
import { setParkEntrance } from '../../src/sim/guests/park';
import { spawnGuest } from '../../src/sim/guests/guest-store';
import { refreshQueueIndex } from '../../src/sim/rides/queue-lines';
import { createRide, placeRideEntranceExit } from '../../src/sim/rides/ride-operations';
import { RideType } from '../../src/sim/rides/ride-types';

export const MAP_SIZE = 40;
/** Merry-go-round covering (10..12, 2..4); its exit hut is on the east side and fronts (14, 3). */
export const EXIT = { x: 13, y: 3 };
export const EXIT_FRONT = { x: 14, y: 3 };
/** Path tiles beside the hut, along the ride's east side. */
export const EXIT_SIDES = [
  { x: 13, y: 2 },
  { x: 13, y: 4 },
];

/**
 * A closed ride whose exit hut sits between two path tiles of a busy two-lane footpath: lanes at
 * x = 13 (broken by the hut) and x = 14, a crowd walking both. Nobody is riding, so nobody has a
 * reason to step onto the hut.
 */
export function crowdedExitPark(guests = 60): Uint8Array {
  const w = new World({ seed: 11, width: MAP_SIZE, height: MAP_SIZE, maxGuests: 200 });
  prepareFlat(w);
  const lane = (x: number): Array<[number, number]> =>
    Array.from({ length: 11 }, (_, k) => [x, 0 + k + 1] as [number, number]);
  layPath(
    w,
    lane(13).filter(([, y]) => y !== EXIT.y),
  );
  layPath(w, [[EXIT.x, EXIT.y]]);
  layPath(w, lane(14));
  layPath(w, row(12, 11, 14));
  layPath(w, [[11, 5]], true);
  layPath(w, [[11, 6]], true);
  layPath(w, row(7, 8, 11));
  layPath(w, [[8, 8]]);
  const id = createRide(w, RideType.MerryGoRound, 11, 3);
  placeRideEntranceExit(w, id, { x: 11, y: 5 }, { x: EXIT.x, y: EXIT.y });
  refreshQueueIndex(w);

  setParkEntrance(w, 14, 12);
  for (let i = 0; i < guests; i++) {
    if (!spawnGuest(w)) break;
    const slot = w.guests.count - 1;
    const tileY = 1 + ((i * 7) % 11);
    const tileX = 13 + (i % 2);
    if (tileX === EXIT.x && tileY === EXIT.y) continue;
    w.guests.cols.x[slot] = tileX * 256 + 128;
    w.guests.cols.y[slot] = tileY * 256 + 128;
    w.guests.cols.z[slot] = w.map.heightAt(w.guests.cols.x[slot], w.guests.cols.y[slot]);
    w.guests.cols.energy[slot] = 255;
    w.guests.cols.hunger[slot] = 255;
    w.guests.cols.thirst[slot] = 255;
    w.guests.cols.happiness[slot] = 255;
    w.guests.cols.cash[slot] = 0;
  }
  return serialize(w);
}
