import { TRACK_STEPS_PER_LEVEL } from '../sim/core/constants';
import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim/core/simulation';
import { OWNED } from '../sim/map/tile-map';
import { createCoaster } from '../sim/rides/coaster-fixtures';
import { RideType } from '../sim/rides/ride-types';
import { PieceId } from '../sim/track/catalog';
import { applyTrackCommand } from '../sim/track/track-commands';
import { PieceMode, TrackResult } from '../sim/track/track-types';
import { createSnapshot, writeSnapshot } from '../worker/snapshot';
import { CoasterScene } from './coaster-scene';
import { TrenchIndex } from './trench-index';
import type { MapData } from './renderer';

const LEVEL = 5;

/** A wooden coaster whose straight track runs through a ridge three levels high. */
function tunnelWorld(ridge = [0, 1, 2, 3, 3, 3, 3, 3, 2, 1, 0]): { sim: Simulation; map: MapData } {
  const sim = new Simulation({ seed: 9, width: 40, height: 40, maxGuests: 0 });
  const m = sim.world.map;
  m.waterLevel.fill(0);
  m.fillFlat(LEVEL);
  m.ownership.fill(OWNED);
  for (let vy = 0; vy <= m.height; vy++)
    for (let vx = 0; vx <= m.width; vx++)
      m.vertexHeights[m.vertexIndex(vx, vy)] = LEVEL + (ridge[vx - 19] ?? 0);
  for (let i = 0; i < m.width * m.height; i++) m.refreshTile(i);
  const rideId = createCoaster(sim, RideType.WoodenCoaster, 4, 4);
  for (let x = 14; x <= 31; x++)
    expect(
      applyTrackCommand(sim.world, {
        type: 'placeTrack',
        rideId,
        pieceType: x === 14 ? PieceId.Station : PieceId.Flat,
        x,
        y: 20,
        z: LEVEL * TRACK_STEPS_PER_LEVEL,
        dir: 0,
        mode: PieceMode.Normal,
      }),
    ).toBe(TrackResult.Ok);
  const map: MapData = {
    width: m.width,
    height: m.height,
    heights: m.heights,
    surface: m.surface,
    slope: m.slope,
    waterLevel: m.waterLevel,
  };
  return { sim, map };
}

function scene(sim: Simulation, map: MapData, rotation: 0 | 1 | 2 | 3, underground = false) {
  const w = sim.world;
  const snapshot = createSnapshot({
    guests: 0,
    staff: 0,
    vehicles: 0,
    litter: 0,
    rides: w.rides.count,
    tracks: w.track.pieces.count,
    mapTiles: w.map.width * w.map.height,
  });
  writeSnapshot(w, snapshot);
  const out = new CoasterScene();
  out.build(snapshot, map, rotation, underground);
  return out.items.slice(0, out.length);
}

function trenchesOf(sim: Simulation, map: MapData) {
  const w = sim.world;
  const snapshot = createSnapshot({
    guests: 0,
    staff: 0,
    vehicles: 0,
    litter: 0,
    rides: w.rides.count,
    tracks: w.track.pieces.count,
    mapTiles: w.map.width * w.map.height,
  });
  writeSnapshot(w, snapshot);
  const index = new TrenchIndex();
  index.update(snapshot, map);
  return index.tiles;
}

describe('tunnels in the coaster scene', () => {
  const { sim, map } = tunnelWorld();

  it.each([0, 1, 2, 3] as const)('draws no portal sprite in rotation %i', (rotation) => {
    expect(scene(sim, map, rotation).some((item) => item.key.includes('/tunnel/'))).toBe(false);
  });

  it('shows hidden track as x-ray copies only in the underground view', () => {
    expect(scene(sim, map, 0).some((item) => item.xray)).toBe(false);
    const xray = scene(sim, map, 0, true).filter((item) => item.xray);
    expect(xray.length).toBeGreaterThan(4);
    expect(xray.every((item) => item.key.includes('/track/'))).toBe(true);
  });

  it('leaves track in an open trench out of the x-ray copies', () => {
    const trenches = trenchesOf(sim, map);
    expect(trenches.size).toBe(2);
    const w = sim.world;
    const snapshot = createSnapshot({
      guests: 0,
      staff: 0,
      vehicles: 0,
      litter: 0,
      rides: w.rides.count,
      tracks: w.track.pieces.count,
      mapTiles: w.map.width * w.map.height,
    });
    writeSnapshot(w, snapshot);
    const all = new CoasterScene();
    all.build(snapshot, map, 0, true);
    const cut = new CoasterScene();
    cut.build(snapshot, map, 0, true, trenches);
    const xrays = (s: CoasterScene) => s.items.slice(0, s.length).filter((i) => i.xray).length;
    expect(xrays(cut)).toBe(xrays(all) - trenches.size);
  });
});

describe('trenches follow the land shape', () => {
  it('cuts a headwall at each end of a tunnel through a steep hillside', () => {
    const { sim, map } = tunnelWorld();
    const heads = [...trenchesOf(sim, map).values()].map((t) => [t.lowHead, t.highHead]);
    expect(heads).toEqual([
      [false, true],
      [true, false],
    ]);
  });

  it('cuts into the side of a gentle hill too', () => {
    const { sim, map } = tunnelWorld([0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0]);
    expect(trenchesOf(sim, map).size).toBe(2);
  });

  it('cuts nothing where a corner entry would have been', () => {
    const { sim, map } = tunnelWorld([0, 0, 0]);
    expect(trenchesOf(sim, map).size).toBe(0);
  });
});
