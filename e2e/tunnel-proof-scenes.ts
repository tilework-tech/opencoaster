import { TRACK_STEPS_PER_LEVEL } from '../src/sim/core/constants';
import type { World } from '../src/sim/core/world';
import { createRide } from '../src/sim/rides/ride-operations';
import { RideType } from '../src/sim/rides/ride-types';
import { pieceByName } from '../src/sim/track/catalog';
import { trenchTiles } from '../src/sim/track/trench';
import type { TrackPiecePlacement } from '../src/sim/track/trench';
import { getConstructionCursor } from '../src/sim/track/construction';
import { applyTrackCommand } from '../src/sim/track/track-commands';
import { PieceMode, TrackResult } from '../src/sim/track/track-types';
import { createScenarioWorld } from './footpath-helpers';

export type SceneName = 'face' | 'slope' | 'cut';

export interface ProofScene {
  world: World;
  /** Fixed-point point at the foot of each headwall, in the order along the track. */
  mouths: { x: number; y: number; z: number }[];
  /** Tile the camera is centred on. */
  focus: { x: number; y: number };
}

const GROUND = 7;
const STATION = { x: 40, y: 52 };

/** Open Grounds with a ridge `profile` levels high across x = 47..58 and y = 46..57. */
function terrain(profile: readonly number[]): World {
  const world = createScenarioWorld('open-grounds');
  const map = world.map;
  map.waterLevel.fill(0);
  for (let vy = 0; vy <= map.height; vy++)
    for (let vx = 0; vx <= map.width; vx++)
      map.vertexHeights[map.vertexIndex(vx, vy)] =
        GROUND + Math.min(profile[vx - 47] ?? 0, profile[vy - 46] ?? 0);
  for (let i = 0; i < map.width * map.height; i++) map.refreshTile(i);
  world.research.unlocked.add(RideType.WoodenCoaster);
  return world;
}

const LAYOUTS: Record<SceneName, { profile: number[]; pieces: string[]; focus: [number, number] }> =
  {
    face: {
      profile: [0, 1, 2, 3, 3, 3, 3, 3, 3, 2, 1, 0],
      pieces: ['station', ...Array(20).fill('flat')],
      focus: [49, 52],
    },
    slope: {
      profile: [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
      pieces: ['station', ...Array(20).fill('flat')],
      focus: [49, 52],
    },
    cut: {
      profile: [],
      pieces: [
        'station',
        ...Array(6).fill('flat'),
        'flatToDown25',
        'down25ToFlat',
        ...Array(4).fill('flat'),
        'flatToUp25',
        'up25ToFlat',
        ...Array(4).fill('flat'),
      ],
      focus: [49, 52],
    },
  };

/** Builds a coaster through the simulation's own track command, so every piece is rule-checked. */
export function buildScene(name: SceneName): ProofScene {
  const layout = LAYOUTS[name];
  const world = terrain(layout.profile);
  const rideId = createRide(world, RideType.WoodenCoaster, 36, 56);
  const placed: TrackPiecePlacement[] = [];
  for (const piece of layout.pieces) {
    const cursor = getConstructionCursor(world, rideId);
    const request = {
      type: 'placeTrack' as const,
      rideId,
      pieceType: pieceByName(piece)!.id,
      x: cursor.hasTrack ? cursor.x : STATION.x,
      y: cursor.hasTrack ? cursor.y : STATION.y,
      z: cursor.hasTrack ? cursor.z : GROUND * TRACK_STEPS_PER_LEVEL,
      dir: cursor.hasTrack ? cursor.dir : 0,
      mode: PieceMode.Normal,
    };
    const result = applyTrackCommand(world, request);
    if (result !== TrackResult.Ok)
      throw new Error(
        `${name}: ${piece} at ${request.x},${request.y} z${request.z} gave ${result}`,
      );
    placed.push({
      pieceType: request.pieceType,
      x: request.x,
      y: request.y,
      z: request.z,
      dir: request.dir,
    });
  }
  const mouths: ProofScene['mouths'] = [];
  for (const tile of trenchTiles(world.map, placed).values()) {
    const x = tile.index % world.map.width;
    const y = (tile.index - x) / world.map.width;
    for (const end of [0, 1]) {
      if (!(end === 0 ? tile.lowHead : tile.highHead)) continue;
      const along = (end === 0 ? 0 : 256) + (tile.axis === 0 ? x : y) * 256;
      mouths.push({
        x: tile.axis === 0 ? along : x * 256 + 128,
        y: tile.axis === 0 ? y * 256 + 128 : along,
        z: end === 0 ? tile.lowZ : tile.highZ,
      });
    }
  }
  return { world, mouths, focus: { x: layout.focus[0], y: layout.focus[1] } };
}
