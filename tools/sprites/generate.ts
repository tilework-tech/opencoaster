import { writeSpriteDef } from './output';
import type { SpriteDef } from './output';
import { renderMesh } from './raster';
import { clipMesh, rotateMesh, rotatePoint, translateMesh } from './mesh';
import type { Mesh } from './mesh';
import type { TrackPieceDef } from '../../src/sim/track/track-types';
import { CAR_HEADINGS, CAR_PITCHES } from './models/coaster';
import type { CarPitch } from './models/coaster';
import { RIDE_MODELS, rideMesh } from './models/rides';
import { TRANSPORT_PIECES, TRANSPORT_STYLES } from './models/transport';
import { PATH_STYLES, pathMesh } from './models/paths';
import { WATER_FRAMES, waterTexture } from './models/water';

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
  for (const model of RIDE_MODELS)
    for (let view = 0; view < 4; view++)
      out.push({
        key: `${model.key}/view-${view}`,
        frames: Array.from({ length: model.frames }, (_, frame) =>
          renderMesh(rotateMesh(rideMesh(model, frame), view)),
        ),
        footprint: ONE_TILE,
      });
  return out;
}

/** Track cell sprites for one piece: each footprint cell clipped to its tile in all four views. */
function trackCellSprites(style: string, piece: TrackPieceDef, local: Mesh): SpriteDef[] {
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

function vehicleSprites(
  style: string,
  car: (heading: number, pitch: CarPitch) => Mesh,
): SpriteDef[] {
  const out: SpriteDef[] = [];
  for (const pitch of CAR_PITCHES)
    for (let heading = 0; heading < CAR_HEADINGS; heading++)
      out.push({
        key: `vehicles/${style}/car/${pitch}/heading-${heading}`,
        frames: [renderMesh(car(heading, pitch))],
        footprint: ONE_TILE,
      });
  return out;
}

function transportSprites(): SpriteDef[] {
  const out: SpriteDef[] = [];
  for (const transport of TRANSPORT_STYLES) {
    for (const piece of TRANSPORT_PIECES)
      out.push(...trackCellSprites(transport.style, piece, transport.track(piece)));
    out.push(...vehicleSprites(transport.style, transport.car));
  }
  return out;
}

/** Every sprite this tool renders, keyed as in the atlas manifest. */
export function buildSprites(): SpriteDef[] {
  return [...pathSprites(), ...waterSprites(), ...rideSprites(), ...transportSprites()];
}

export async function renderSprites(outputDir: string): Promise<SpriteDef[]> {
  const defs = buildSprites();
  await Promise.all(defs.map((def) => writeSpriteDef(outputDir, def)));
  return defs;
}
