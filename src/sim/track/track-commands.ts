import type { World } from '../core/world';
import type { Command } from '../core/commands';
import { placeTrack, removeTrack } from './construction';
import type { Direction, PieceMode } from './track-types';

export type TrackCommand = Extract<Command, { type: 'placeTrack' | 'removeTrack' }>;

/** Applies a track command; the outcome is recorded in `world.track.lastResult`. */
export function applyTrackCommand(world: World, c: TrackCommand): void {
  if (c.type === 'placeTrack') {
    placeTrack(world, {
      rideId: c.rideId,
      pieceType: c.pieceType,
      x: c.x,
      y: c.y,
      z: c.z,
      dir: c.dir as Direction,
      mode: c.mode as PieceMode,
    });
  } else {
    removeTrack(world, c.rideId, c.pieceId);
  }
}
