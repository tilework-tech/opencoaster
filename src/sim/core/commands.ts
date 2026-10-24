import type { EconomyAction } from '../economy/actions';
import type { MapCommand } from '../map/map-commands';
import type { ResearchAction } from '../research/research';
import type { RideCommand } from '../rides/ride-commands';
import type { RideType } from '../rides/ride-types';

/**
 * Player/debug inputs. Commands are applied at the start of a tick, in arrival order, so
 * replaying (seed, [(tick, command)...]) reproduces a game exactly.
 */
export type Command =
  | { type: 'spawnGuests'; count: number }
  | { type: 'spawnStaff'; count: number; kind: number }
  | { type: 'setParkEntrance'; x: number; y: number }
  | { type: 'hireStaff'; kind: number }
  | { type: 'fireStaff'; staffId: number }
  | { type: 'setStaffPatrolTile'; staffId: number; x: number; y: number; enabled: boolean }
  | { type: 'setStaffKindPatrolTile'; kind: number; x: number; y: number; enabled: boolean }
  | { type: 'renameStaff'; staffId: number; name: string }
  | { type: 'setFlowerBed'; x: number; y: number; enabled: boolean }
  | { type: 'createRide'; rideType: RideType; x: number; y: number }
  | MapCommand
  | RideCommand
  | { type: 'economy'; action: EconomyAction }
  | { type: 'research'; action: ResearchAction }
  | {
      type: 'placeTrack';
      rideId: number;
      pieceType: number;
      x: number;
      y: number;
      z: number;
      dir: number;
      mode: number;
    }
  | { type: 'removeTrack'; rideId: number; pieceId: number };

export interface TimedCommand {
  tick: number;
  command: Command;
}
