import { TILE_UNITS } from '../../src/sim/core/constants';
import { dropLitter, LitterKind } from '../../src/sim/guests/litter-store';
import { spawnGuest } from '../../src/sim/guests/guest-store';
import { FLOWER_BED, FLOWER_BED_THIRSTY } from '../../src/sim/staff/grounds';
import { PathAddition, setPathAddition } from '../../src/sim/map/paths';
import { markPathElementBroken } from '../../src/sim/map/tile-map';
import { StaffKind, spawnStaff } from '../../src/sim/staff/staff-store';
import type { Simulation } from '../../src/sim/core/simulation';
import type { Tile } from '../footpath-helpers';
import { serialize } from '../../src/save/save';
import { breakdownScene } from './breakdown-scene';

export interface StaffScene {
  sim: Simulation;
  /** The serialized park before any staff work has happened. */
  before: Uint8Array;
  /** Stable staff ids by role. */
  ids: { handyman: number; mechanic: number; security: number; entertainer: number };
  /** Tile at the middle of the staffed stretch of path. */
  centre: Tile;
}

const ROW_Y = 42;
const PATH_FROM = 30;
const PATH_TO = 38;

/**
 * The breakdown scene's merry-go-round and mechanic, plus a handyman, entertainer and security
 * guard on the same path, litter, vomit, a full bin, a vandalised bench, long grass, a thirsty
 * flower bed and guests walking by, simulated until every role has some work to show.
 */
export function staffScene(options: { cleaners?: boolean } = {}): StaffScene {
  const cleaners = options.cleaners ?? true;
  const { sim } = breakdownScene();
  const world = sim.world;
  const hire = (kind: StaffKind, tileX: number): number => {
    if (!spawnStaff(world, kind)) throw new Error('spawnStaff');
    const slot = world.staff.count - 1;
    world.staff.cols.x[slot] = tileX * TILE_UNITS + TILE_UNITS / 2;
    world.staff.cols.y[slot] = ROW_Y * TILE_UNITS + TILE_UNITS / 2;
    world.staff.cols.targetX[slot] = tileX;
    world.staff.cols.targetY[slot] = ROW_Y;
    return slot;
  };
  const mechanicSlot = world.staff.count - 1;
  const handymanSlot = cleaners ? hire(StaffKind.Handyman, 33) : -1;
  const securitySlot = cleaners ? hire(StaffKind.Security, 36) : -1;
  const entertainerSlot = cleaners ? hire(StaffKind.Entertainer, 31) : -1;
  if (cleaners) world.staff.cols.mowTimeout[handymanSlot] = 12;

  for (const x of [31, 34, 35, 37]) dropLitter(world, x, ROW_Y, LitterKind.Trash);
  dropLitter(world, 36, ROW_Y, LitterKind.Vomit);
  dropLitter(world, 36, ROW_Y, LitterKind.Vomit);
  dropLitter(world, 37, ROW_Y, LitterKind.Vomit);
  setPathAddition(world.map, 32, ROW_Y, PathAddition.Bin);
  world.map.elData[world.map.pathElement(world.map.index(32, ROW_Y), -1)] = 0b11111100;
  setPathAddition(world.map, 35, ROW_Y, PathAddition.Bench);
  markPathElementBroken(world.map, world.map.pathElement(world.map.index(35, ROW_Y), -1));
  for (const x of [33, 34, 35]) world.grounds[world.map.index(x, ROW_Y - 1)] = 13;
  world.grounds[world.map.index(37, ROW_Y - 1)] = FLOWER_BED | FLOWER_BED_THIRSTY;

  for (let n = 0; n < 16; n++) {
    if (!spawnGuest(world)) throw new Error('spawnGuest');
    const slot = world.guests.count - 1;
    const tileX = PATH_FROM + (n % (PATH_TO - PATH_FROM + 1));
    world.guests.cols.x[slot] = tileX * TILE_UNITS + TILE_UNITS / 2;
    world.guests.cols.y[slot] = ROW_Y * TILE_UNITS + TILE_UNITS / 2;
    world.guests.cols.z[slot] = world.map.heightAt(
      world.guests.cols.x[slot],
      world.guests.cols.y[slot],
    );
    world.guests.cols.happiness[slot] = 90;
    world.guests.cols.happinessTarget[slot] = 90;
  }

  const before = serialize(world);
  const cols = world.staff.cols;
  for (let tick = 0; cleaners && tick < 20_000; tick++) {
    sim.step();
    if (
      cols.lawnsMown[handymanSlot] >= 1 &&
      cols.sweeps[handymanSlot] >= 2 &&
      cols.binsEmptied[handymanSlot] >= 1 &&
      cols.gardensWatered[handymanSlot] >= 1 &&
      cols.ridesFixed[mechanicSlot] >= 1 &&
      cols.guestsEntertained[entertainerSlot] >= 1
    )
      break;
  }
  const ids = world.staff.slotToId;
  return {
    sim,
    before,
    ids: {
      handyman: ids[handymanSlot] ?? -1,
      mechanic: ids[mechanicSlot],
      security: ids[securitySlot] ?? -1,
      entertainer: ids[entertainerSlot] ?? -1,
    },
    centre: { x: 34, y: ROW_Y },
  };
}
