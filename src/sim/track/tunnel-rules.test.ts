import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { LandAction, LandResult, planLand } from '../map/land-tool';
import { placePath } from '../map/paths';
import { OWNED } from '../map/tile-map';
import { createCoaster } from '../rides/coaster-fixtures';
import { RideType } from '../rides/ride-types';
import { PieceId } from './catalog';
import { applyTrackCommand } from './track-commands';
import { PieceMode, TrackResult } from './track-types';

const LEVEL = 5;

/** A 40x40 owned park at level 5 with a ridge three levels high across x = 20..27. */
function hillPark(): { sim: Simulation; rideId: number } {
  const sim = new Simulation({ seed: 9, width: 40, height: 40, maxGuests: 0 });
  const map = sim.world.map;
  map.waterLevel.fill(0);
  map.fillFlat(LEVEL);
  map.ownership.fill(OWNED);
  const ridge = [0, 1, 2, 3, 3, 3, 3, 3, 2, 1, 0];
  for (let vy = 0; vy <= map.height; vy++)
    for (let vx = 0; vx <= map.width; vx++)
      map.vertexHeights[map.vertexIndex(vx, vy)] = LEVEL + (ridge[vx - 19] ?? 0);
  for (let i = 0; i < map.width * map.height; i++) map.refreshTile(i);
  const rideId = createCoaster(sim, RideType.WoodenCoaster, 4, 4);
  return { sim, rideId };
}

function place(sim: Simulation, rideId: number, x: number, pieceType: number = PieceId.Flat) {
  return applyTrackCommand(sim.world, {
    type: 'placeTrack',
    rideId,
    pieceType,
    x,
    y: 20,
    z: LEVEL,
    dir: 0,
    mode: PieceMode.Normal,
  });
}

function buildUpTo(sim: Simulation, rideId: number, lastX: number): void {
  expect(place(sim, rideId, 14, PieceId.Station)).toBe(TrackResult.Ok);
  for (let x = 15; x <= lastX; x++)
    expect(place(sim, rideId, x), `piece at x=${x}`).toBe(TrackResult.Ok);
}

describe('tunnels through terrain', () => {
  it('accepts track that runs into a hill and out again', () => {
    const { sim, rideId } = hillPark();
    buildUpTo(sim, rideId, 31);
    expect(sim.world.track.count[rideId]).toBeGreaterThan(10);
  });

  it('refuses a tunnel section under a footpath', () => {
    const { sim, rideId } = hillPark();
    buildUpTo(sim, rideId, 22);
    expect(placePath(sim.world.map, { x: 24, y: 20, z: LEVEL + 3 })).toBe(true);
    expect(place(sim, rideId, 23)).toBe(TrackResult.TunnelBlocked);
  });

  it('refuses a tunnel section under another ride', () => {
    const { sim, rideId } = hillPark();
    createCoaster(sim, RideType.MerryGoRound, 24, 20);
    expect(sim.world.rides.count).toBe(2);
    buildUpTo(sim, rideId, 21);
    expect(place(sim, rideId, 22)).toBe(TrackResult.TunnelBlocked);
  });

  it('refuses a tunnel section under water', () => {
    const { sim, rideId } = hillPark();
    buildUpTo(sim, rideId, 22);
    const map = sim.world.map;
    const tile = map.index(24, 20);
    map.waterLevel[tile] = map.heights[tile] + 1;
    expect(place(sim, rideId, 23)).toBe(TrackResult.TunnelBlocked);
  });

  it('refuses land edits that would bury or expose track in a tunnel', () => {
    const { sim, rideId } = hillPark();
    buildUpTo(sim, rideId, 31);
    for (const action of [LandAction.Raise, LandAction.Lower]) {
      const plan = planLand(sim.world, { action, x: 23, y: 20, width: 1, height: 1 });
      expect(plan.result).toBe(LandResult.RideInTheWay);
    }
  });
});
