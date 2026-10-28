import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { SCENARIO_PREVIEW_RENDERER_VERSION } from './scenario-preview';

const scenarioDirectory = resolve(process.cwd(), 'src/sim/scenario/scenarios');
const previewDirectory = resolve(process.cwd(), 'public/scenario-previews');

describe('scenario preview assets', () => {
  it('ships current 1x and 2x previews for every scenario map', async () => {
    const manifest = JSON.parse(
      readFileSync(resolve(previewDirectory, 'manifest.json'), 'utf8'),
    ) as {
      rendererVersion: number;
      scenarios: Record<
        string,
        { sourceHash: string; oneX: string; twoX: string; width: number; height: number }
      >;
    };
    const scenarios = readdirSync(scenarioDirectory)
      .filter((file) => file.endsWith('.json'))
      .map((file) => {
        const source = readFileSync(resolve(scenarioDirectory, file));
        return {
          source,
          def: JSON.parse(source.toString()) as {
            id: string;
            map: { width: number; height: number };
          },
        };
      });

    expect(manifest.rendererVersion).toBe(SCENARIO_PREVIEW_RENDERER_VERSION);
    expect(Object.keys(manifest.scenarios).sort()).toEqual(
      scenarios.map(({ def }) => def.id).sort(),
    );

    for (const { source, def } of scenarios) {
      const preview = manifest.scenarios[def.id];
      if (!preview) throw new Error(`Missing scenario preview entry for ${def.id}`);
      expect(preview.sourceHash, def.id).toBe(createHash('sha256').update(source).digest('hex'));
      expect(statSync(resolve(previewDirectory, preview.oneX)).isFile(), def.id).toBe(true);
      expect(statSync(resolve(previewDirectory, preview.twoX)).isFile(), def.id).toBe(true);
      const oneX = await sharp(resolve(previewDirectory, preview.oneX))
        .raw()
        .toBuffer({ resolveWithObject: true });
      const twoX = await sharp(resolve(previewDirectory, preview.twoX))
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(oneX.info).toMatchObject({ width: def.map.width, height: def.map.height });
      expect(twoX.info).toMatchObject({ width: def.map.width * 2, height: def.map.height * 2 });
      let pixelated = true;
      for (let y = 0; y < def.map.height && pixelated; y++) {
        for (let x = 0; x < def.map.width; x++) {
          const offset = (y * def.map.width + x) * 4;
          const pixel = oneX.data.subarray(offset, offset + 4);
          for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) {
              const doubledOffset = ((y * 2 + dy) * def.map.width * 2 + x * 2 + dx) * 4;
              if (!twoX.data.subarray(doubledOffset, doubledOffset + 4).equals(pixel)) {
                pixelated = false;
                break;
              }
            }
            if (!pixelated) break;
          }
          if (!pixelated) break;
        }
      }
      expect(pixelated, `${def.id} 2x image should preserve crisp tile pixels`).toBe(true);
    }
  });
});
