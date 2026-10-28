import { describe, expect, it } from 'vitest';
import { flatWorld, layPath, row } from '../sim/integration/fixtures';
import { createRide, placeRideEntranceExit } from '../sim/rides/ride-operations';
import { refreshQueueIndex } from '../sim/rides/queue-lines';
import { RideType } from '../sim/rides/ride-types';
import { PATH_BOARDING_BITS } from '../sim/map/tile-map';
import { DIR_E, DIR_W } from '../sim/pathfinding';
import type { World } from '../sim/core/world';
import { deserialize, serialize } from './save';
import { allWorldViews, withoutColumns } from './legacy-save-fixtures';

/** Encodes a world as the last version before entrances and exits had a front edge. */
function asPreviousVersion(world: World): Uint8Array {
  return withoutColumns(serialize(world), 27, allWorldViews(world), []);
}

describe('loading a save from before entrances and exits had a front edge', () => {
  it('keeps a queue that leaves its entrance sideways, and an exit on the path beside it', () => {
    const w = flatWorld();
    layPath(w, row(5, 2, 8));
    layPath(w, row(5, 9, 11), true);
    layPath(w, [[13, 3]]);
    layPath(w, [[14, 3]]);
    const id = createRide(w, RideType.MerryGoRound, 11, 3);
    placeRideEntranceExit(w, id, { x: 11, y: 5 }, { x: 13, y: 3 });
    refreshQueueIndex(w);
    for (let i = 0; i < w.map.width * w.map.height; i++)
      for (let e = w.map.firstElement(i); e >= 0; e = w.map.nextElement(e))
        w.map.elData[e] &= ~PATH_BOARDING_BITS;

    const loaded = deserialize(asPreviousVersion(w));
    refreshQueueIndex(loaded);

    const entrance = loaded.map.index(11, 5);
    const exit = loaded.map.index(13, 3);
    expect(loaded.map.pathEdges(entrance)).toBe(1 << DIR_W);
    expect(loaded.queues.hasQueue[0]).toBe(1);
    expect(loaded.queues.tiles[0]).toBe(2);
    expect(loaded.queues.joinTile[0]).toBe(loaded.map.index(8, 5));
    expect(loaded.map.pathEdges(exit)).toBe(1 << DIR_E);
  });
});
