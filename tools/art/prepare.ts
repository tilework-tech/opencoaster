import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import sharp from 'sharp';
import { renderSprites } from '../sprites/generate';

const sourceDirectory = new URL('./source/', import.meta.url);
const outputDirectory = new URL('../../public/sprites/', import.meta.url);

interface FrameRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SpriteInfo {
  anchor: { x: number; y: number };
  footprint: { width: number; height: number };
}

async function cell(source: Buffer, bounds: FrameRegion): Promise<Buffer> {
  const crop = await sharp(source)
    .extract({ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let left = crop.info.width;
  let top = crop.info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < crop.info.height; y++) {
    for (let x = 0; x < crop.info.width; x++) {
      if (crop.data[(y * crop.info.width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) throw new Error('Source sheet contains an empty cell');

  for (let offset = 0; offset < crop.data.length; offset += 4) {
    if (crop.data[offset + 3] !== 0) continue;
    crop.data[offset] = 0;
    crop.data[offset + 1] = 0;
    crop.data[offset + 2] = 0;
  }
  return sharp(crop.data, {
    raw: { width: crop.info.width, height: crop.info.height, channels: 4 },
  })
    .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .png()
    .toBuffer();
}

async function cleanedImage(source: Buffer, maxDimension: number): Promise<Buffer> {
  const { data, info } = await sharp(source)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] !== 0) continue;
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: 'inside',
      kernel: 'nearest',
      withoutEnlargement: true,
    })
    .png({ palette: true, colors: 64, dither: 0, compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
}

async function orientImage(source: Buffer, orientation: number): Promise<Buffer> {
  let image = sharp(source);
  if (orientation & 1) image = image.flop();
  if (orientation & 2) image = image.flip();
  return image.png().toBuffer();
}

function gridBounds(
  width: number,
  height: number,
  columns: number,
  rows: number,
  column: number,
  row: number,
): FrameRegion {
  const x = Math.floor((column * width) / columns);
  const y = Math.floor((row * height) / rows);
  const right = Math.floor(((column + 1) * width) / columns);
  const bottom = Math.floor(((row + 1) * height) / rows);
  return { x, y, width: right - x, height: bottom - y };
}

function outputPath(spriteId: string): URL {
  return new URL(`${spriteId}.png`, outputDirectory);
}

async function saveSprite(spriteId: string, image: Buffer, info: SpriteInfo): Promise<void> {
  const target = outputPath(spriteId);
  const targetPath = target.pathname;
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, image);
  const dimensions = await sharp(image).metadata();
  const metadata = {
    frames: [{ x: 0, y: 0, width: dimensions.width, height: dimensions.height }],
    ...info,
  };
  await writeFile(targetPath.replace(/\.png$/, '.json'), `${JSON.stringify(metadata, null, 2)}\n`);
}

async function prepareTerrain(): Promise<void> {
  const source = await readFile(new URL('terrain-sheet.png', sourceDirectory));
  const { width, height } = await sharp(source).metadata();
  if (!width || !height) throw new Error('Could not read terrain sheet dimensions');
  const materials = ['grass', 'sand', 'dirt', 'rock'];
  for (let row = 0; row < materials.length; row++) {
    const sourceShapes = await Promise.all(
      Array.from({ length: 4 }, async (_, column) =>
        cleanedImage(await cell(source, gridBounds(width, height, 4, 4, column, row)), 128),
      ),
    );
    for (let shape = 0; shape < 19; shape++) {
      const oriented = await orientImage(
        sourceShapes[shape % sourceShapes.length],
        Math.floor(shape / sourceShapes.length) % 4,
      );
      const cleaned = await cleanedImage(oriented, 128);
      const dimensions = await sharp(cleaned).metadata();
      const spriteId = `terrain/${materials[row]}/shape-${shape.toString(16).padStart(2, '0')}`;
      if (!dimensions.width || !dimensions.height)
        throw new Error(`Could not read cleaned terrain sprite ${spriteId}`);
      await saveSprite(spriteId, cleaned, {
        anchor: { x: Math.floor(dimensions.width / 2), y: dimensions.height },
        footprint: { width: 1, height: 1 },
      });
    }
  }
}

async function prepareProps(): Promise<void> {
  const source = await readFile(new URL('world-props.png', sourceDirectory));
  const { width, height } = await sharp(source).metadata();
  if (!width || !height) throw new Error('Could not read world props dimensions');
  const spriteIds = [
    'trees/tree-oak',
    'trees/tree-conifer',
    'trees/tree-birch',
    'trees/tree-blossom',
    'trees/tree-autumn',
    'trees/tree-topiary',
    'scenery/shrub',
    'scenery/flower-bed',
    'scenery/wooden-fence',
    'scenery/stone-fence',
    'scenery/bench',
    'scenery/bin',
    'scenery/lamp',
    'scenery/park-entrance',
    'scenery/hedge',
    'scenery/queue-rail',
  ];
  for (let index = 0; index < spriteIds.length; index++) {
    const bounds = gridBounds(width, height, 4, 4, index % 4, Math.floor(index / 4));
    const image = await cell(source, bounds);
    const cleaned = await cleanedImage(image, 128);
    const { width: imageWidth, height: imageHeight } = await sharp(cleaned).metadata();
    if (!imageWidth || !imageHeight)
      throw new Error(`Could not read cleaned prop ${spriteIds[index]}`);
    await saveSprite(spriteIds[index], cleaned, {
      anchor: { x: Math.floor(imageWidth / 2), y: imageHeight },
      footprint: { width: 1, height: 1 },
    });
  }
}

async function main(): Promise<void> {
  const destination = outputDirectory.pathname;
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await Promise.all([prepareTerrain(), prepareProps()]);
  await renderSprites(destination);
}

await main();
