import type { Command } from './commands';
import type { System } from './system';
import { World } from './world';
import type { WorldOptions } from './world';
import { spawnGuest } from '../guests/guest-store';
import { applyMapCommand } from '../map/map-commands';
import { spawnStaff } from '../staff/staff-store';
import { guestSystem } from '../guests/guest-system';
import { staffSystem } from '../staff/staff-system';
import { vehicleSystem } from '../vehicles/vehicle-system';
import { litterSystem } from '../guests/litter-system';
import { rideSystem } from '../rides/ride-system';
import { createRide } from '../rides/ride-operations';
import { RIDE_CATALOG, type RideType } from '../rides/ride-types';
import { trackSystem } from '../track/track-system';
import { applyTrackCommand } from '../track/track-commands';
import { PIECES } from '../track/catalog';
import { rotateTile } from '../track/construction';
import { Surface } from '../map/tile-map';
import { LedgerCategory } from '../economy/ledger';
import { economySystem } from '../economy/economy-system';
import { parkInputsSystem } from '../economy/park-inputs';
import { charge } from '../economy/api';
import { rideQueueSystem } from '../rides/queue-system';
import { setParkEntrance } from '../guests/park';
import { weatherSystem } from '../weather/weather-system';
import { researchSystem } from '../research/research-system';
import { scenarioSystem } from '../scenario/scenario-system';
import { applyEconomyAction } from '../economy/actions';
import { applyResearchAction } from '../research/research';

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
  guestSystem,
  staffSystem,
  litterSystem,
  parkInputsSystem,
  economySystem,
  scenarioSystem,
];

function applyCreateRide(w: World, type: RideType, x: number, y: number): void {
  const definition = RIDE_CATALOG[type];
  if (!definition || !Number.isInteger(x) || !Number.isInteger(y)) return;
  if (w.economy.cash < definition.cost) return;

  for (const [dx, dy] of definition.footprint) {
    const tx = x + dx;
    const ty = y + dy;
    if (!w.map.inBounds(tx, ty)) return;
    const tile = w.map.index(tx, ty);
    if (!w.map.canBuild(tile)) return;
    if (
      w.map.surface[tile] === Surface.Path ||
      w.map.surface[tile] === Surface.Queue ||
      w.map.surface[tile] === Surface.Water
    ) {
      return;
    }
  }

  const rides = w.rides;
  for (let existing = 0; existing < rides.count; existing++) {
    const existingDefinition = RIDE_CATALOG[rides.cols.typeId[existing] as RideType];
    if (!existingDefinition) continue;
    for (const [dx, dy] of definition.footprint) {
      for (const [otherDx, otherDy] of existingDefinition.footprint) {
        if (
          x + dx === rides.cols.rideX[existing] + otherDx &&
          y + dy === rides.cols.rideY[existing] + otherDy
        ) {
          return;
        }
      }
    }
  }

  const trackPieces = w.track.pieces;
  for (let existing = 0; existing < trackPieces.count; existing++) {
    const trackDefinition = PIECES[trackPieces.cols.pieceType[existing]];
    for (const [dx, dy] of definition.footprint) {
      for (const cell of trackDefinition.footprint) {
        const [otherDx, otherDy] = rotateTile(cell.i, cell.j, trackPieces.cols.dir[existing]);
        if (
          x + dx === trackPieces.cols.x[existing] + otherDx &&
          y + dy === trackPieces.cols.y[existing] + otherDy
        ) {
          return;
        }
      }
    }
  }

  if (createRide(w, type, x, y) >= 0) charge(w, LedgerCategory.RideConstruction, definition.cost);
}

export class Simulation {
  readonly world: World;
  private pending: Command[] = [];

  constructor(opts: WorldOptions) {
    this.world = new World(opts);
  }

  enqueue(command: Command): void {
    this.pending.push(command);
  }

  /** Advances the world by exactly one tick. */
  step(): void {
    const w = this.world;
    if (this.pending.length > 0) {
      const cmds = this.pending;
      this.pending = [];
      for (const c of cmds) this.apply(c);
    }
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
        setParkEntrance(w, c.x, c.y);
        break;
      case 'createRide':
        applyCreateRide(w, c.rideType, c.x, c.y);
        break;
      default:
        applyMapCommand(w, c);
        break;
      case 'economy':
        applyEconomyAction(w.economy, c.action);
        break;
      case 'research':
        applyResearchAction(w.research, c.action);
        break;
      case 'placeTrack':
        {
          const piece = PIECES[c.pieceType];
          if (piece && w.economy.cash < piece.cost) break;
          const countBefore = w.track.pieces.count;
          applyTrackCommand(w, c);
          if (piece && w.track.pieces.count > countBefore)
            charge(w, LedgerCategory.RideConstruction, piece.cost);
        }
        break;
      case 'removeTrack':
        applyTrackCommand(w, c);
        break;
    }
  }
}
