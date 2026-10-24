import type { System } from '../core/system';
import { removeRideTrack } from './construction';
import { MAX_TRACK_RIDES } from './track-store';

/**
 * Per-tick upkeep. Track edits arrive as commands (see applyTrackCommand); the only per-tick
 * work is dropping the track of rides that were demolished.
 */
export const trackSystem: System = {
  name: 'track',
  update(world) {
    const t = world.track;
    for (let r = 0; r < MAX_TRACK_RIDES; r++) {
      if (t.head[r] >= 0 && !world.rides.isAlive(r)) removeRideTrack(world, r);
    }
  },
};
