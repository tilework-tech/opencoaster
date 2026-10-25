import { writeSpriteDef } from './output';
import type { SpriteDef } from './output';
import { renderMesh } from './raster';
import { coasterSprites } from './models/coaster/sprites';
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

/** Every sprite this tool renders, keyed as in the atlas manifest. */
export function buildSprites(): SpriteDef[] {
  return [...pathSprites(), ...waterSprites(), ...coasterSprites()];
}

export async function renderSprites(outputDir: string): Promise<SpriteDef[]> {
  const defs = buildSprites();
  await Promise.all(defs.map((def) => writeSpriteDef(outputDir, def)));
  return defs;
}
