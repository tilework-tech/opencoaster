import type { Command } from './commands';
import type { System } from './system';
import { World } from './world';
import type { WorldOptions } from './world';
import { spawnGuest } from '../guests/guest-store';
import { spawnStaff } from '../staff/staff-store';
import { guestSystem } from '../guests/guest-system';
import { staffSystem } from '../staff/staff-system';
import { vehicleSystem } from '../vehicles/vehicle-system';
import { litterSystem } from '../guests/litter-system';
import { rideSystem } from '../rides/ride-system';
import { trackSystem } from '../track/track-system';
import { economySystem } from '../economy/economy-system';
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
  vehicleSystem,
  guestSystem,
  staffSystem,
  litterSystem,
  economySystem,
  scenarioSystem,
];

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
      case 'setTileHeight':
        w.map.setHeight(c.x, c.y, c.height);
        break;
      case 'economy':
        applyEconomyAction(w.economy, c.action);
        break;
      case 'research':
        applyResearchAction(w.research, c.action);
        break;
    }
  }
}
