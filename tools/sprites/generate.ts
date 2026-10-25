import { writeSpriteDef } from './output';
import type { SpriteDef } from './output';
import { renderMesh } from './raster';
import { clipMesh, physicalToLevels, rotateMesh, rotatePoint, translateMesh } from './mesh';
import { PIECES } from '../../src/sim/track/catalog';
import { RIDE_CATALOG } from '../../src/sim/rides/ride-types';
import {
  CAR_HEADINGS,
  CAR_PITCHES,
  COASTER_STYLES,
  carMesh,
  supportSegmentMesh,
  trackPieceMesh,
} from './models/coaster';
import { RIDE_MODELS, rideMesh } from './models/rides';
import { PATH_STYLES, pathMesh } from './models/paths';
import { WATER_FRAMES, waterTexture } from './models/water';
import { FACILITY_MODELS } from './models/facilities';
import { STATION_CATEGORIES, stationHutMesh } from './models/stations';
import { parkEntranceMesh } from './models/park-entrance';

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
  const out: SpriteDef[] = [];
  for (const model of RIDE_MODELS) {
    const slug = model.key.slice(model.key.indexOf('/') + 1);
    const ride = Object.values(RIDE_CATALOG).find(
      (definition) => definition.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') === slug,
    );
    if (ride && ['shop', 'stall', 'facility'].includes(ride.category)) continue;
    const group = ride?.category === 'transport' ? 'transport' : 'flat-rides';
    for (let view = 0; view < 4; view++)
      out.push({
        key: `${group}/${slug}/view-${view}`,
        frames: Array.from({ length: model.frames }, (_, frame) =>
          renderMesh(rotateMesh(rideMesh(model, frame), view)),
        ),
        footprint: ONE_TILE,
      });
  }
  return out;
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
  for (const category of STATION_CATEGORIES) {
    const group =
      category === 'transport'
        ? 'transport'
        : category === 'coaster'
          ? 'coaster-steel'
          : 'flat-rides';
    for (const part of ['entrance', 'exit'] as const)
      for (let facing = 0; facing < 4; facing++)
        for (let view = 0; view < 4; view++)
          out.push({
            key: `${group}/stations/${category}/${part}/facing-${facing}/view-${view}`,
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

function parkEntranceSprites(): SpriteDef[] {
  return Array.from({ length: 4 }, (_, view) => ({
    key: `scenery/park-entrance/view-${view}`,
    frames: [renderMesh(rotateMesh(physicalToLevels(parkEntranceMesh(0)), view))],
    footprint: ONE_TILE,
  }));
}

function coasterSprites(): SpriteDef[] {
  const out: SpriteDef[] = [];
  for (const style of COASTER_STYLES) {
    for (const piece of PIECES) {
      const local = trackPieceMesh(piece, style);
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
            key: `coaster-${style}/${piece.name}/view-${view}/cell-${index}`,
            frames: [renderMesh(translateMesh(clipped, -centre[0], -centre[1], 0))],
            footprint: ONE_TILE,
          });
        }
      });
    }
    for (const part of ['column', 'base'] as const)
      for (let view = 0; view < 4; view++)
        out.push({
          key: `coaster-${style}/support-${part}/view-${view}`,
          frames: [renderMesh(rotateMesh(supportSegmentMesh(style, part), view))],
          footprint: ONE_TILE,
        });
    for (const pitch of CAR_PITCHES)
      for (let heading = 0; heading < CAR_HEADINGS; heading++)
        out.push({
          key: `vehicles/${style}/car/${pitch}/heading-${heading}`,
          frames: [renderMesh(carMesh(style, heading, pitch))],
          footprint: ONE_TILE,
        });
  }
  return out;
}

/** Every sprite this tool renders, keyed as in the atlas manifest. */
export function buildSprites(): SpriteDef[] {
  return [
    ...pathSprites(),
    ...waterSprites(),
    ...rideSprites(),
    ...facilitySprites(),
    ...stationSprites(),
    ...parkEntranceSprites(),
    ...coasterSprites(),
  ];
}

export async function renderSprites(outputDir: string): Promise<SpriteDef[]> {
  const defs = buildSprites();
  await Promise.all(defs.map((def) => writeSpriteDef(outputDir, def)));
  return defs;
}
