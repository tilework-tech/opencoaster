import { describe, expect, it } from 'vitest';
import { TILE_UNITS } from '../sim/core/constants';
import { Simulation } from '../sim/core/simulation';
import { OWNED } from '../sim/map/tile-map';
import { RIDE_CATALOG, RideType } from '../sim/rides/ride-types';
import { PIECES, pieceByName } from '../sim/track/catalog';
import { getConstructionCursor, pieceExit } from '../sim/track/construction';
import { PieceFlag, PieceMode, TrackResult } from '../sim/track/track-types';
import { MAX_TRACK_RIDES } from '../sim/track/track-store';
import { applyTrackCommand } from '../sim/track/track-commands';
import { Prng } from '../sim/core/prng';
import { createSnapshot, writeSnapshot } from '../worker/snapshot';
import { CoasterScene } from './coaster-scene';
import { createCoaster } from '../sim/rides/coaster-fixtures';

const ROTATIONS = [0, 1, 2, 3] as const;
const SEEDS = [3, 11, 29, 71, 113] as const;

function rideWorld(seed: number): { simulation: Simulation; rideId: number } {
  const simulation = new Simulation({ seed, width: 64, height: 64, maxGuests: 0 });
  simulation.world.map.heights.fill(3);
  simulation.world.map.ownership.fill(OWNED);
  simulation.world.research.unlocked.add(RideType.WoodenCoaster);
  const rideId = createCoaster(simulation, RideType.WoodenCoaster, 24, 24);
  return { simulation, rideId };
}

function buildSeed(seed: number): Simulation {
  const { simulation, rideId } = rideWorld(seed);
  const random = new Prng(seed);
  const allowed = RIDE_CATALOG[RideType.WoodenCoaster].trackRules?.allowedPieces;
  const candidates = PIECES.filter((piece) => !allowed || allowed.includes(piece.id));
  let built = 0;

  const station = pieceByName('station')!;
  expect(
    applyTrackCommand(simulation.world, {
      type: 'placeTrack',
      rideId,
      pieceType: station.id,
      x: 24,
      y: 24,
      z: 8,
      dir: seed & 3,
      mode: PieceMode.Normal,
    }),
  ).toBe(TrackResult.Ok);
  built++;

  for (let attempt = 0; attempt < 2000 && built < 48; attempt++) {
    const cursor = getConstructionCursor(simulation.world, rideId);
    const connectable = candidates.filter(
      (piece) => piece.entrySlope === cursor.slope && piece.entryBank === cursor.bank,
    );
    const piece = connectable[random.nextU32() % connectable.length]!;
    const result = applyTrackCommand(simulation.world, {
      type: 'placeTrack',
      rideId,
      pieceType: piece.id,
      x: cursor.x,
      y: cursor.y,
      z: cursor.z,
      dir: cursor.dir,
      mode: piece.flags & PieceFlag.LiftOk ? PieceMode.ChainLift : PieceMode.Normal,
    });
    if (result === TrackResult.CircuitClosed) {
      // A closed ride remains a valid generated route; this seed has reached its end.
      break;
    }
    if (result === TrackResult.Ok) built++;
  }
  expect(built, `seed ${seed} should build a connected route`).toBeGreaterThanOrEqual(3);
  return simulation;
}

describe('track builder continuity and scene footprint', () => {
  it.each(SEEDS)('keeps seeded builder placements connected and visible (seed %i)', (seed) => {
    const simulation = buildSeed(seed);
    const world = simulation.world;
    const track = world.track.pieces;
    const columns = track.cols;

    for (let rideId = 0; rideId < MAX_TRACK_RIDES; rideId++) {
      if (world.track.head[rideId] < 0) continue;
      const snapshot = createSnapshot({
        guests: 0,
        staff: 0,
        vehicles: 0,
        litter: 0,
        rides: world.rides.count,
        tracks: world.track.pieces.count,
        mapTiles: world.map.width * world.map.height,
      });
      writeSnapshot(world, snapshot);
      const map = {
        width: world.map.width,
        height: world.map.height,
        heights: world.map.heights,
        surface: world.map.surface,
        slope: world.map.slope,
        waterLevel: world.map.waterLevel,
      };
      const scene = new CoasterScene();
      let id = world.track.head[rideId];
      let previousExit: ReturnType<typeof pieceExit> | null = null;
      const expectedTiles = new Set<string>();
      do {
        const slot = track.idToSlot[id]!;
        const piece = PIECES[columns.pieceType[slot]]!;
        const placement = {
          x: columns.x[slot]!,
          y: columns.y[slot]!,
          z: columns.z[slot]!,
          dir: columns.dir[slot]!,
        };
        if (previousExit) {
          expect(placement).toEqual(previousExit);
        }
        previousExit = pieceExit(piece.id, placement.x, placement.y, placement.z, placement.dir);
        for (const cell of piece.footprint) {
          let dx = cell.i;
          let dy = cell.j;
          for (let turn = 0; turn < placement.dir; turn++) [dx, dy] = [-dy, dx];
          expectedTiles.add(`${placement.x + dx},${placement.y + dy}`);
        }

        id = columns.next[slot]!;
      } while (id >= 0 && id !== world.track.head[rideId]);

      for (const rotation of ROTATIONS) {
        scene.build(snapshot, map, rotation);
        const drawnTiles = new Set(
          scene.items
            .filter((item) => item.rideId === rideId && item.key.includes('/track/'))
            .map((item) => `${item.x / TILE_UNITS - 0.5},${item.y / TILE_UNITS - 0.5}`),
        );
        expect(drawnTiles, `track tiles in view ${rotation}`).toEqual(expectedTiles);
      }
    }
  });
});
