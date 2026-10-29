import type { Command } from './commands';
import type { System } from './system';
import { World } from './world';
import type { WorldOptions } from './world';
import { spawnGuest } from '../guests/guest-store';
import { applyMapCommand } from '../map/map-commands';
import {
  fireStaff,
  hireStaff,
  renameStaff,
  setStaffOrder,
  setStaffKindPatrolTile,
  setStaffPatrolTile,
  spawnStaff,
} from '../staff/staff-store';
import { setFlowerBed } from '../staff/grounds';
import { guestSystem } from '../guests/guest-system';
import { vandalismSystem } from '../guests/vandalism';
import { staffSystem } from '../staff/staff-system';
import { vehicleSystem } from '../vehicles/vehicle-system';
import { litterSystem } from '../guests/litter-system';
import { rideSystem } from '../rides/ride-system';
import { FeedbackDomain, reportFeedback } from './feedback';
import { RideResult } from '../rides/ride-results';
import { coasterSystem } from '../rides/coaster-system';
import { applyRideCommand, refreshRideQueueConnections } from '../rides/ride-commands';
import { createRide } from '../rides/ride-operations';
import { validateRidePlacement } from '../rides/ride-footprint';
import { RIDE_CATALOG, RideType } from '../rides/ride-types';
import {
  DEFAULT_TOWER_HEIGHT,
  isValidObservationTowerHeight,
  observationTowerCost,
} from '../rides/observation-tower';
import { trackSystem } from '../track/track-system';
import { applyTrackCommand } from '../track/track-commands';
import { setPersonPosition } from './person-position';
import { LedgerCategory } from '../economy/ledger';
import { economySystem } from '../economy/economy-system';
import { parkInputsSystem } from '../economy/park-inputs';
import { charge } from '../economy/api';
import { rideQueueSystem } from '../rides/queue-system';
import { setParkEntrance } from '../guests/park';
import { purgeExteriorMess } from '../guests/park-interior';
import { weatherSystem } from '../weather/weather-system';
import { researchSystem } from '../research/research-system';
import { scenarioSystem } from '../scenario/scenario-system';
import { applyEconomyCommand } from '../economy/actions';
import { applyResearchAction, isUnlocked } from '../research/research';

/**
 * Fixed execution order. Adding a system means adding one line here; ordering is part of the
 * determinism contract, so changes should be deliberate and reviewed.
 */
export const SYSTEM_ORDER: readonly System[] = [
  weatherSystem,
  researchSystem,
  trackSystem,
  rideSystem,
  rideQueueSystem,
  vehicleSystem,
  coasterSystem,
  guestSystem,
  staffSystem,
  vandalismSystem,
  litterSystem,
  parkInputsSystem,
  economySystem,
  scenarioSystem,
];

function applyCreateRide(
  w: World,
  type: RideType,
  x: number,
  y: number,
  dir: number,
  towerHeight = DEFAULT_TOWER_HEIGHT,
): void {
  const report = (code: RideResult, rideId = -1): void =>
    reportFeedback(w.feedback, FeedbackDomain.Ride, code, rideId);
  const definition = RIDE_CATALOG[type];
  const cost =
    type === RideType.ObservationTower
      ? observationTowerCost(definition?.cost ?? 0, towerHeight)
      : (definition?.cost ?? 0);
  if (!definition || !Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(dir))
    return report(RideResult.OutOfBounds);
  if (type === RideType.ObservationTower && !isValidObservationTowerHeight(towerHeight))
    return report(RideResult.Blocked);
  if (!isUnlocked(w, type)) return report(RideResult.ResearchRequired);
  if (w.economy.cash < cost) return report(RideResult.InsufficientFunds);
  const placement = validateRidePlacement(w, type, x, y, dir & 3, towerHeight);
  if (placement !== RideResult.Ok) return report(placement);

  const rideId = createRide(w, type, x, y, dir & 3, towerHeight);
  if (rideId < 0) return report(RideResult.Blocked);
  charge(w, LedgerCategory.RideConstruction, cost);
  report(RideResult.Ok, rideId);
}

export class Simulation {
  readonly world: World;
  private pending: Command[] = [];

  /** Accepts options for a new world, or an existing world (for example one just deserialised). */
  constructor(opts: WorldOptions | World) {
    this.world = opts instanceof World ? opts : new World(opts);
  }

  enqueue(command: Command): void {
    this.pending.push(command);
  }

  /** Applies accepted commands without advancing time or running simulation systems. */
  applyPendingCommands(): boolean {
    if (this.pending.length === 0) return false;
    const w = this.world;
    const commands = this.pending;
    this.pending = [];
    for (const command of commands) {
      const mapRevision = w.map.revision;
      const rides = w.rides.count;
      const tracks = w.track.pieces.count;
      this.apply(command);
      if (
        w.map.revision !== mapRevision ||
        w.rides.count !== rides ||
        w.track.pieces.count !== tracks
      ) {
        const removal = command.type === 'removePath' || command.type === 'removeTrack';
        w.audioEvents.push({ id: ++w.audioEventSequence, type: removal ? 'demolish' : 'build' });
      }
    }
    return true;
  }

  /** Advances the world by exactly one tick. */
  step(): void {
    const w = this.world;
    this.applyPendingCommands();
    for (const system of SYSTEM_ORDER) system.update(w);
    w.tick++;
  }

  private apply(c: Command): void {
    const w = this.world;
    switch (c.type) {
      case 'spawnGuests':
        for (let i = 0; i < c.count; i++) if (!spawnGuest(w)) break;
        break;
      case 'spawnStaff':
        for (let i = 0; i < c.count; i++) if (!spawnStaff(w, c.kind)) break;
        break;
      case 'setParkEntrance':
        if (setParkEntrance(w, c.x, c.y)) purgeExteriorMess(w);
        break;
      case 'hireStaff':
        hireStaff(w, c.kind);
        break;
      case 'fireStaff':
        fireStaff(w, c.staffId);
        break;
      case 'setStaffPatrolTile':
        setStaffPatrolTile(w, c.staffId, c.x, c.y, c.enabled);
        break;
      case 'setStaffKindPatrolTile':
        setStaffKindPatrolTile(w, c.kind, c.x, c.y, c.enabled);
        break;
      case 'renameStaff':
        renameStaff(w, c.staffId, c.name);
        break;
      case 'setPersonPosition':
        setPersonPosition(w, c.person, c.personId, c.x, c.y);
        break;
      case 'setStaffOrder':
        setStaffOrder(w, c.staffId, c.order, c.enabled);
        break;
      case 'setFlowerBed':
        setFlowerBed(w, c.x, c.y, c.enabled);
        break;
      case 'createRide':
        applyCreateRide(w, c.rideType, c.x, c.y, c.dir ?? 0, c.towerHeight);
        break;
      case 'placeRideEntrance':
      case 'placeRideExit':
      case 'setRideStatus':
      case 'setRidePrice':
      case 'setRideQueueLimit':
      case 'setObservationTowerHeight':
      case 'setRideTrains':
      case 'setRideMode':
      case 'setRideInspection':
      case 'demolishRide':
        applyRideCommand(w, c);
        break;
      default:
        applyMapCommand(w, c);
        if (c.type === 'placePath' || c.type === 'placePathRun' || c.type === 'removePath')
          refreshRideQueueConnections(w);
        break;
      case 'economy':
        reportFeedback(w.feedback, FeedbackDomain.Economy, applyEconomyCommand(w, c.action));
        break;
      case 'research':
        applyResearchAction(w.research, c.action);
        break;
      case 'placeTrack':
      case 'removeTrack':
        applyTrackCommand(w, c);
        break;
    }
  }
}
