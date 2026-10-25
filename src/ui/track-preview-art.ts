import type { RideType } from '../sim/rides/ride-types';
import {
  trackedRideFamily,
  trackCellSprites,
  transportFamily,
  transportTrackCells,
} from '../render/coaster-art';
import type { TrackCellSprite } from '../render/coaster-art';

export function trackPreviewSprites(
  rideType: RideType,
  pieceType: number,
  direction: number,
  rotation: number,
  tick: number,
): TrackCellSprite[] {
  const family = trackedRideFamily(rideType);
  if (family) return trackCellSprites(pieceType, direction, rotation, family, 0, tick);
  const transport = transportFamily(rideType);
  if (transport) return transportTrackCells(pieceType, direction, rotation, transport);
  return [];
}
