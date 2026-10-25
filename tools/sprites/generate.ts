import { writeSpriteDef } from './output';
import type { SpriteDef } from './output';
import { renderMesh } from './raster';
import { coasterSprites } from './models/coaster/sprites';
import { PATH_STYLES, pathMesh } from './models/paths';
import { WATER_FRAMES, waterTexture } from './models/water';
import { RIDE_CATALOG, RideType } from '../../src/sim/rides/ride-types';
import { rideSpriteName } from '../../src/render/world-art';
import { RIDE_MODELS } from './models/ride-catalog';
import { rideMesh } from './models/rides';
import { clipMesh, physicalToLevels, rotateMesh, rotatePoint, translateMesh } from './mesh';
import type { Mesh } from './mesh';
import { FACILITY_MODELS } from './models/facilities';
import { parkEntranceMesh } from './models/park-entrance';
import { STATION_CATEGORIES, stationHutMesh } from './models/stations';
import { cactusTreeMesh, palmTreeMesh } from './models/trees';
import { LOG_FLUME_MODEL } from './models/log-flume';
import { RIVER_RAPIDS_MODEL } from './models/river-rapids';
import { personMesh } from './models/people';
import { rideMesh as transportRideMesh } from './models/ride-model';
import { GO_KARTS_MODEL } from './models/go-karts';
import { TRANSPORT_PIECES, TRANSPORT_STYLES } from './models/transport';
import {
  WATER_CAR_PITCHES,
  WATER_RIDE_FAMILIES,
  waterCarMesh,
  waterTrackMesh,
} from './models/water-track';
import { PIECES } from '../../src/sim/track/catalog';
import { PieceFlag } from '../../src/sim/track/track-types';
import type { TrackPieceDef } from '../../src/sim/track/track-types';

const ONE_TILE = { width: 1, height: 1 };

function hex2(value: number): string {
  return value.toString(16).padStart(2, '0');
}

function pathSprites(): SpriteDef[] {
  const out: SpriteDef[] = [];
  for (const style of PATH_STYLES) {
    for (let mask = 0; mask < 16; mask++)
      out.push({
        key: `paths/${style}/connection-${hex2(mask)}`,
        frames: [renderMesh(pathMesh({ style, mask }), { outline: false })],
        footprint: ONE_TILE,
      });
    for (let direction = 0; direction < 4; direction++)
      out.push({
        key: `paths/${style}/ramp-${direction}`,
        frames: [renderMesh(pathMesh({ style, mask: 0, slope: direction }), { outline: false })],
        footprint: ONE_TILE,
      });
  }
  return out;
}

function waterSprites(): SpriteDef[] {
  const out: SpriteDef[] = [
    {
      key: 'water/surface',
      frames: Array.from({ length: WATER_FRAMES }, (_, f) => waterTexture(f)),
      footprint: ONE_TILE,
      raw: true,
    },
  ];
  return out;
}

function rideSprites(): SpriteDef[] {
  return RIDE_MODELS.flatMap((baseModel) => {
    const model = baseModel.key === 'rides/go-karts' ? GO_KARTS_MODEL : baseModel;
    const ride = Object.values(RIDE_CATALOG).find(
      (definition) =>
        `rides/${definition.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` === model.key,
    );
    if (
      ride &&
      (['shop', 'stall', 'facility', 'water'].includes(ride.category) ||
        ride.category === 'coaster')
    )
      return [];
    const xs = ride?.footprint.map(([x]) => x) ?? [0];
    const ys = ride?.footprint.map(([, y]) => y) ?? [0];
    const footprint = {
      width: Math.max(...xs) - Math.min(...xs) + 1,
      height: Math.max(...ys) - Math.min(...ys) + 1,
    };
    const spriteName = ride ? rideSpriteName(ride.id) : model.key;
    const frames =
      ride &&
      ride.id !== RideType.GoKarts &&
      !ride.usesTrack &&
      (ride.category === 'gentle' || ride.category === 'thrill')
        ? 9
        : model.frames;
    return Array.from({ length: 4 }, (_, view): SpriteDef => ({
      key: `${spriteName}/view-${view}`,
      frames: Array.from({ length: frames }, (_, frame) =>
        renderMesh(rotateMesh(rideMesh(model, frame), view)),
      ),
      footprint,
    }));
  });
}

function facilitySprites(): SpriteDef[] {
  const out: SpriteDef[] = [];
  for (const model of FACILITY_MODELS)
    for (let facing = 0; facing < 4; facing++)
      for (let view = 0; view < 4; view++)
        out.push({
          key: `${model.key.replace(/^facilities\//, 'stalls/')}/facing-${facing}/view-${view}`,
          frames: Array.from({ length: model.frames }, (_, frame) =>
            renderMesh(
              rotateMesh(rotateMesh(physicalToLevels(model.build(frame)), (facing + 3) & 3), view),
            ),
          ),
          footprint: ONE_TILE,
        });
  return out;
}

function stationSprites(): SpriteDef[] {
  const out: SpriteDef[] = [];
  const combinations = STATION_CATEGORIES.flatMap((category) =>
    category === 'coaster'
      ? ['wood', 'steel', 'junior', 'mouse'].map((family) => ({ category, family }))
      : [{ category, family: '' }],
  );
  for (const { category, family } of combinations) {
    const group = category === 'transport' || category === 'water' ? 'transport' : 'rides/flat';
    for (const part of ['entrance', 'exit'] as const)
      for (let facing = 0; facing < 4; facing++)
        for (let view = 0; view < 4; view++)
          out.push({
            key:
              category === 'coaster'
                ? `rides/coaster/${family}/stations/${part}/facing-${facing}/view-${view}`
                : `${group}/stations/${category}/${part}/facing-${facing}/view-${view}`,
            frames: [
              renderMesh(
                rotateMesh(
                  rotateMesh(physicalToLevels(stationHutMesh(category, part)), (facing + 3) & 3),
                  view,
                ),
              ),
            ],
            footprint: ONE_TILE,
          });
  }
  return out;
}

function treeSprites(): SpriteDef[] {
  return [
    {
      key: 'trees/tree-palm',
      frames: [renderMesh(physicalToLevels(palmTreeMesh()))],
      footprint: ONE_TILE,
    },
    {
      key: 'trees/tree-cactus',
      frames: [renderMesh(physicalToLevels(cactusTreeMesh()))],
      footprint: ONE_TILE,
    },
  ];
}

function parkEntranceSprites(): SpriteDef[] {
  return Array.from({ length: 4 }, (_, view) => ({
    key: `scenery/park-entrance/view-${view}`,
    frames: [renderMesh(rotateMesh(physicalToLevels(parkEntranceMesh(0)), view))],
    footprint: ONE_TILE,
  }));
}

function transportRideSprites(): SpriteDef[] {
  return [LOG_FLUME_MODEL, RIVER_RAPIDS_MODEL].flatMap((model) =>
    Array.from({ length: 4 }, (_, view) => ({
      key: `transport/${model.key.split('/').at(-1)}/view-${view}`,
      frames: Array.from({ length: model.frames }, (_, frame) =>
        renderMesh(rotateMesh(transportRideMesh(model, frame), view)),
      ),
      footprint: ONE_TILE,
    })),
  );
}

function peopleSprites(): SpriteDef[] {
  const out: SpriteDef[] = [];
  for (let kind = 0; kind < 4; kind++)
    for (let direction = 0; direction < 4; direction++)
      out.push({
        key: `people/staff/${kind}/direction-${direction}`,
        frames: Array.from({ length: 2 }, (_, frame) =>
          renderMesh(personMesh(kind, direction, frame, true)),
        ),
        footprint: ONE_TILE,
      });
  return out;
}

function transportTrackCellSprites(style: string, piece: TrackPieceDef, local: Mesh): SpriteDef[] {
  const out: SpriteDef[] = [];
  piece.footprint.forEach((cell, index) => {
    for (let view = 0; view < 4; view++) {
      const turned = rotateMesh(local, view);
      const centre = rotatePoint([cell.i, cell.j, 0], view);
      const clipped = clipMesh(
        turned,
        centre[0] - 0.5,
        centre[0] + 0.5,
        centre[1] - 0.5,
        centre[1] + 0.5,
      );
      if (clipped.length === 0) continue;
      out.push({
        key: `track/${style}/${piece.name}/view-${view}/cell-${index}`,
        frames: [renderMesh(translateMesh(clipped, -centre[0], -centre[1], 0))],
        footprint: ONE_TILE,
      });
    }
  });
  return out;
}

function transportSprites(): SpriteDef[] {
  const out: SpriteDef[] = [];
  for (const transport of TRANSPORT_STYLES) {
    for (const piece of TRANSPORT_PIECES)
      out.push(...transportTrackCellSprites(transport.style, piece, transport.track(piece)));
    for (const pitch of ['flat', 'up25', 'up60', 'down25', 'down60'] as const)
      for (let heading = 0; heading < 8; heading++)
        out.push({
          key: `vehicles/${transport.style}/car/${pitch}/heading-${heading}`,
          frames: [renderMesh(transport.car(heading, pitch))],
          footprint: ONE_TILE,
        });
  }
  return out;
}

/** Every sprite this tool renders, keyed as in the atlas manifest. */
function waterTrackSprites(): SpriteDef[] {
  const out: SpriteDef[] = [];
  for (const family of WATER_RIDE_FAMILIES) {
    const ride = RIDE_CATALOG[family === 'log-flume' ? RideType.LogFlume : RideType.RiverRapids];
    for (const piece of PIECES) {
      if (!ride.trackRules?.allowedPieces?.includes(piece.id)) continue;
      const variants = [''];
      if (piece.flags & PieceFlag.LiftOk) variants.push('+water-lift');
      for (let view = 0; view < 4; view++)
        for (const variant of variants)
          for (let cell = 0; cell < piece.footprint.length; cell++) {
            const centre = rotatePoint([piece.footprint[cell].i, piece.footprint[cell].j, 0], view);
            const local = waterTrackMesh(
              piece,
              !!(piece.flags & PieceFlag.WaterSplash),
              variant === '+water-lift',
            );
            const turned = rotateMesh(local, view);
            const clipped = clipMesh(
              turned,
              centre[0] - 0.5,
              centre[0] + 0.5,
              centre[1] - 0.5,
              centre[1] + 0.5,
            );
            if (clipped.length === 0) continue;
            out.push({
              key: `rides/water/${family}/track/${piece.name}${variant}/view-${view}/cell-${cell}`,
              frames: [renderMesh(translateMesh(clipped, -centre[0], -centre[1], 0))],
              footprint: ONE_TILE,
            });
          }
    }
    for (let pitchIndex = 0; pitchIndex < WATER_CAR_PITCHES.length; pitchIndex++)
      for (let heading = 0; heading < 8; heading++)
        for (let passengers = 0; passengers <= 7; passengers++)
          out.push({
            key: `rides/water/${family}/vehicles/car/${WATER_CAR_PITCHES[pitchIndex]}/heading-${heading}/passengers-${passengers}`,
            frames: [renderMesh(waterCarMesh(family, heading, pitchIndex - 3, passengers))],
            footprint: ONE_TILE,
          });
  }
  return out;
}

export function buildSprites(): SpriteDef[] {
  return [
    ...pathSprites(),
    ...waterSprites(),
    ...rideSprites(),
    ...transportRideSprites(),
    ...facilitySprites(),
    ...stationSprites(),
    ...parkEntranceSprites(),
    ...treeSprites(),
    ...coasterSprites(),
    ...waterTrackSprites(),
    ...transportSprites(),
    ...peopleSprites(),
  ];
}

export async function renderSprites(outputDir: string): Promise<SpriteDef[]> {
  const defs = buildSprites();
  await Promise.all(defs.map((def) => writeSpriteDef(outputDir, def)));
  return defs;
}
