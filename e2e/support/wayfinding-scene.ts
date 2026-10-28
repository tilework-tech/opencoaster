import { readFileSync } from 'node:fs';
import type { World } from '../../src/sim/core/world';
import { Simulation } from '../../src/sim/core/simulation';
import { setPersonPosition } from '../../src/sim/core/person-position';
import { GuestState, GuestThought } from '../../src/sim/guests/guest-store';
import { LEAVING_COUNTDOWN, LOST_WANDER_TICKS } from '../../src/sim/guests/navigation';
import { layPath, openRide, row } from '../../src/sim/integration/fixtures';
import { RideType } from '../../src/sim/rides/ride-types';
import { parseScenarioFile } from '../../src/sim/scenario/scenario-file';
import { prepareScenario } from '../../src/sim/scenario/scenario-layout';
import { spawnGuest } from '../../src/sim/guests/guest-store';
import type { Tile } from '../footpath-helpers';

/** Centre of the maze, for the camera. */
export const MAZE_CENTRE: Tile = { x: 32, y: 38 };
/** An information kiosk beside the gate path, outside the maze. */
const KIOSK_CORNER: Tile = { x: 32, y: 43 };
const KIOSK_ENTRANCE: Tile = { x: 31, y: 43 };
const KIOSK_EXIT: Tile = { x: 33, y: 43 };
/** Where each leaving guest starts, spread over the maze. */
const LEAVERS: Tile[] = [
  { x: 27, y: 36 },
  { x: 36, y: 36 },
  { x: 28, y: 40 },
  { x: 37, y: 40 },
  { x: 33, y: 38 },
  { x: 29, y: 38 },
];
const SHOPPER: Tile = { x: 31, y: 46 };

/** The thought the guest list shows: the newest in its ring. */
function latestThought(world: World, slot: number): number {
  const g = world.guests.cols;
  const ring = [g.thought0, g.thought1, g.thought2, g.thought3];
  return ring[(g.thoughtCursor[slot] + 3) & 3]![slot]!;
}

export interface WayfindingScene {
  sim: Simulation;
  /** Guests that are leaving the park and cannot find a way out of the maze. */
  leavers: number[];
  /** Stable ids of `leavers`, without id 0, which the guest list does not show. */
  leaverIds: number[];
  kiosk: number;
}

/**
 * Three looping footpath rows with a few cross links, joined to nothing: the park gate is out of
 * reach. Six guests start leaving inside it and wander until each has walked a full exit countdown.
 * Beside the gate path a lost guest walks to an information kiosk and buys a park map.
 */
export function wayfindingScene(): WayfindingScene {
  const scenario = parseScenarioFile(
    JSON.parse(
      readFileSync(
        new URL('../../src/sim/scenario/scenarios/starter.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  const sim = new Simulation({
    seed: scenario.seed,
    width: scenario.mapWidth,
    height: scenario.mapHeight,
  });
  const world = sim.world;
  prepareScenario(world, scenario);
  layPath(world, row(36, 26, 38));
  layPath(world, row(38, 26, 38));
  layPath(world, row(40, 26, 38));
  layPath(world, [
    [26, 37],
    [38, 39],
    [34, 37],
    [30, 39],
    [32, 39],
  ]);
  layPath(world, [[31, 43]]);
  const kiosk = openRide(
    world,
    RideType.InformationKiosk,
    [KIOSK_CORNER.x, KIOSK_CORNER.y],
    [KIOSK_ENTRANCE.x, KIOSK_ENTRANCE.y],
    [KIOSK_EXIT.x, KIOSK_EXIT.y],
  );

  const place = (tile: Tile): number => {
    if (!spawnGuest(world)) throw new Error('spawnGuest');
    const slot = world.guests.count - 1;
    if (!setPersonPosition(world, 'guest', world.guests.slotToId[slot]!, tile.x, tile.y))
      throw new Error(`cannot place a guest on ${tile.x},${tile.y}`);
    const g = world.guests.cols;
    g.cash[slot] = 4_000;
    g.happiness[slot] = 200;
    g.happinessTarget[slot] = 200;
    g.hunger[slot] = 255;
    g.thirst[slot] = 255;
    g.energy[slot] = 128;
    return slot;
  };

  const leavers = LEAVERS.map((tile) => {
    const slot = place(tile);
    const g = world.guests.cols;
    g.state[slot] = GuestState.Leaving;
    g.lostCountdown[slot] = LEAVING_COUNTDOWN;
    return slot;
  });
  const shopper = place(SHOPPER);
  world.guests.cols.lostTicks[shopper] = LOST_WANDER_TICKS;

  const shopperId = world.guests.slotToId[shopper]!;
  let mapBought = false;
  for (let tick = 0; tick < 40_000; tick++) {
    sim.step();
    const g = world.guests.cols;
    const shopperSlot = world.guests.idToSlot[shopperId] ?? -1;
    if (shopperSlot >= 0 && g.hasMap[shopperSlot] === 1) mapBought = true;
    const exitThinkers = leavers.filter(
      (slot) => latestThought(world, slot) === GuestThought.CantFindExit,
    );
    if (exitThinkers.length >= 4 && mapBought) {
      return {
        sim,
        leavers,
        leaverIds: leavers.map((slot) => world.guests.slotToId[slot]!).filter((id) => id > 0),
        kiosk,
      };
    }
  }
  const g = world.guests.cols;
  throw new Error(
    `the maze guests never got lost: ${world.guests.count} guests ${leavers.map((slot) => `${g.lostCountdown[slot]}/${g.state[slot]}/${g.thought0[slot]}`).join(' ')} map bought ${mapBought} rides ${world.rides.cols.guestsServed[kiosk]}`,
  );
}
