import { writeSpriteDef } from './output';
import type { SpriteDef } from './output';
import { renderMesh } from './raster';
import { PATH_STYLES, pathMesh } from './models/paths';
import { WATER_FRAMES, waterTexture } from './models/water';
import { RIDE_CATALOG } from '../../src/sim/rides/ride-types';
import { rideSpriteName } from '../../src/render/world-art';
import { RIDE_MODELS } from './models/ride-catalog';
import { rideMesh } from './models/rides';
import { rotateMesh } from './mesh';

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
  return RIDE_MODELS.flatMap((model) => {
    const ride = Object.values(RIDE_CATALOG).find(
      (definition) =>
        `rides/${definition.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` === model.key,
    );
    const xs = ride?.footprint.map(([x]) => x) ?? [0];
    const ys = ride?.footprint.map(([, y]) => y) ?? [0];
    const footprint = {
      width: Math.max(...xs) - Math.min(...xs) + 1,
      height: Math.max(...ys) - Math.min(...ys) + 1,
    };
    const spriteName = ride ? rideSpriteName(ride.id) : model.key;
    const frames =
      ride && !ride.usesTrack && (ride.category === 'gentle' || ride.category === 'thrill')
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

/** Every sprite this tool renders, keyed as in the atlas manifest. */
export function buildSprites(): SpriteDef[] {
  return [...pathSprites(), ...waterSprites(), ...rideSprites()];
}

export async function renderSprites(outputDir: string): Promise<SpriteDef[]> {
  const defs = buildSprites();
  await Promise.all(defs.map((def) => writeSpriteDef(outputDir, def)));
  return defs;
}
