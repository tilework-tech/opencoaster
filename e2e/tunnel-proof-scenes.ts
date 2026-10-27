import { TRACK_STEPS_PER_LEVEL } from '../src/sim/core/constants';
import type { World } from '../src/sim/core/world';
import { createRide } from '../src/sim/rides/ride-operations';
import { RideType } from '../src/sim/rides/ride-types';
import { pieceByName } from '../src/sim/track/catalog';
import { pieceTunnelPortals } from '../src/sim/track/clearance';
import type { TunnelPortal } from '../src/sim/track/clearance';
import { getConstructionCursor } from '../src/sim/track/construction';
import { applyTrackCommand } from '../src/sim/track/track-commands';
import { PieceMode, TrackResult } from '../src/sim/track/track-types';
import { createScenarioWorld } from './footpath-helpers';

export type SceneName = 'face' | 'slope' | 'cut';

export interface ProofScene {
  world: World;
  portals: TunnelPortal[];
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
  const portals: TunnelPortal[] = [];
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
    portals.push(
      ...pieceTunnelPortals(
        world.map,
        request.pieceType,
        request.x,
        request.y,
        request.z,
        request.dir,
      ),
    );
  }
  return { world, portals, focus: { x: layout.focus[0], y: layout.focus[1] } };
}
