import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { World } from '../../src/sim/core/world';
import { parseScenarioFile } from '../../src/sim/scenario/scenario-file';
import { prepareScenario } from '../../src/sim/scenario/scenario-layout';
import {
  renderScenarioPreview,
  SCENARIO_PREVIEW_RENDERER_VERSION,
} from '../../src/sim/scenario/scenario-preview';

const root = process.cwd();
const scenarioDirectory = resolve(root, 'src/sim/scenario/scenarios');
const outputDirectory = resolve(root, 'public/scenario-previews');

interface PreviewManifest {
  rendererVersion: number;
  scenarios: Record<
    string,
    { sourceHash: string; oneX: string; twoX: string; width: number; height: number }
  >;
}

const manifest: PreviewManifest = {
  rendererVersion: SCENARIO_PREVIEW_RENDERER_VERSION,
  scenarios: {},
};

mkdirSync(outputDirectory, { recursive: true });
for (const filename of readdirSync(scenarioDirectory)
  .filter((file) => file.endsWith('.json'))
  .sort()) {
  const source = readFileSync(resolve(scenarioDirectory, filename));
  const scenario = parseScenarioFile(JSON.parse(source.toString()));
  const world = new World({
    seed: scenario.seed,
    width: scenario.mapWidth,
    height: scenario.mapHeight,
  });
  prepareScenario(world, scenario);
  const image = renderScenarioPreview(world);
  const raw = { raw: { width: image.width, height: image.height, channels: 4 as const } };
  const oneX = `${scenario.id}@1x.png`;
  const twoX = `${scenario.id}@2x.png`;
  const oneXBytes = await sharp(image.pixels, raw)
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
  const twoXBytes = await sharp(image.pixels, raw)
    .resize(image.width * 2, image.height * 2, { kernel: sharp.kernel.nearest })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();

  writeIfChanged(resolve(outputDirectory, oneX), oneXBytes);
  writeIfChanged(resolve(outputDirectory, twoX), twoXBytes);
  manifest.scenarios[scenario.id] = {
    sourceHash: createHash('sha256').update(source).digest('hex'),
    oneX,
    twoX,
    width: image.width,
    height: image.height,
  };
}

const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
writeIfChanged(resolve(outputDirectory, 'manifest.json'), manifestBytes);

function writeIfChanged(path: string, contents: Buffer): void {
  try {
    if (readFileSync(path).equals(contents)) return;
  } catch {
    // The output does not exist yet.
  }
  writeFileSync(path, contents);
}
