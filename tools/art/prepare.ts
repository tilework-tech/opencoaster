import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import sharp from 'sharp';
import { renderSprites } from '../sprites/generate';
import { renderUiIcons } from '../sprites/ui-icons';
import { PREPARED_PROP_SPRITES, PREPARED_TERRAIN_MATERIALS } from './prepared-assets';
import { defringeRgba } from './image-cleanup';
import { cutProps } from './prop-cutter';

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

  const cleaned = defringeRgba(crop.data, crop.info.width, crop.info.height);
  return sharp(cleaned, {
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
  const cleaned = defringeRgba(data, info.width, info.height);
  return sharp(cleaned, { raw: { width: info.width, height: info.height, channels: 4 } })
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

async function opaqueTexture(source: Buffer, size: number, seed: number): Promise<Buffer> {
  const pixels = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const centerX = Math.floor(pixels.info.width / 2);
  const centerY = Math.floor(pixels.info.height / 2);
  const findOpaqueSample = (minimumAlpha: number): number => {
    for (let radius = 0; radius < Math.max(pixels.info.width, pixels.info.height); radius++) {
      for (
        let y = Math.max(0, centerY - radius);
        y <= Math.min(pixels.info.height - 1, centerY + radius);
        y++
      ) {
        for (
          let x = Math.max(0, centerX - radius);
          x <= Math.min(pixels.info.width - 1, centerX + radius);
          x++
        ) {
          const offset = (y * pixels.info.width + x) * 4;
          if (pixels.data[offset + 3]! >= minimumAlpha) return offset;
        }
      }
    }
    return -1;
  };
  const opaqueSample = findOpaqueSample(250);
  const sampleOffset = opaqueSample >= 0 ? opaqueSample : findOpaqueSample(1);
  if (sampleOffset < 0) throw new Error('Generated texture source has no opaque pixels');

  const texture = Buffer.alloc(size * size * 4);
  let state = (0x9e3779b9 ^ seed) >>> 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      const noise = (state % 5) - 2;
      for (let channel = 0; channel < 3; channel++)
        texture[offset + channel] = Math.max(
          0,
          Math.min(255, pixels.data[sampleOffset + channel]! + noise),
        );
      texture[offset + 3] = 255;
    }
  }
  return sharp(texture, { raw: { width: size, height: size, channels: 4 } })
    .png()
    .toBuffer();
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
  const source = await readFile(new URL('terrain-shapes.png', sourceDirectory));
  const { width, height } = await sharp(source).metadata();
  if (!width || !height) throw new Error('Could not read terrain sheet dimensions');
  const materials = PREPARED_TERRAIN_MATERIALS;
  for (let row = 0; row < materials.length; row++) {
    let flatTerrain: Buffer | undefined;
    for (let shape = 0; shape < 16; shape++) {
      const cleaned = await cleanedImage(
        await cell(source, gridBounds(width, height, 20, 4, shape, row)),
        128,
      );
      if (shape === 0) flatTerrain = cleaned;
      const dimensions = await sharp(cleaned).metadata();
      const spriteId = `terrain/${materials[row]}/shape-${shape.toString(16).padStart(2, '0')}`;
      if (!dimensions.width || !dimensions.height)
        throw new Error(`Could not read cleaned terrain sprite ${spriteId}`);
      await saveSprite(spriteId, cleaned, {
        anchor: { x: Math.floor(dimensions.width / 2), y: dimensions.height },
        footprint: { width: 1, height: 1 },
      });
    }
    if (!flatTerrain) throw new Error(`Missing flat terrain texture for ${materials[row]}`);
    const flatDimensions = await sharp(flatTerrain).metadata();
    if (!flatDimensions.width || !flatDimensions.height)
      throw new Error(`Could not read flat terrain texture for ${materials[row]}`);
    const patch = await opaqueTexture(flatTerrain, 16, row);
    await saveSprite(`terrain/${materials[row]}/surface`, patch, {
      anchor: { x: 0, y: 0 },
      footprint: { width: 1, height: 1 },
    });
    for (let direction = 0; direction < 4; direction++) {
      const cleaned = await cleanedImage(
        await cell(source, gridBounds(width, height, 20, 4, 16 + direction, row)),
        128,
      );
      const dimensions = await sharp(cleaned).metadata();
      if (!dimensions.width || !dimensions.height)
        throw new Error(`Could not read terrain cliff face ${materials[row]} ${direction}`);
      await saveSprite(`terrain/${materials[row]}/cliff-face-${direction}`, cleaned, {
        anchor: { x: Math.floor(dimensions.width / 2), y: dimensions.height },
        footprint: { width: 1, height: 1 },
      });
    }
  }
}

async function prepareProps(): Promise<void> {
  const source = await readFile(new URL('world-props.png', sourceDirectory));
  const { data, info } = await sharp(source)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const spriteIds = PREPARED_PROP_SPRITES;
  const props = cutProps(data, info.width, info.height, 4, 4);
  if (props.length !== spriteIds.length) throw new Error('Prop sheet does not match sprite list');
  for (let index = 0; index < spriteIds.length; index++) {
    const prop = props[index]!;
    const image = await sharp(prop.data, {
      raw: { width: prop.width, height: prop.height, channels: 4 },
    })
      .png()
      .toBuffer();
    const cleaned = await cleanedImage(image, 128);
    const { width: imageWidth, height: imageHeight } = await sharp(cleaned).metadata();
    if (!imageWidth || !imageHeight)
      throw new Error(`Could not read cleaned prop ${spriteIds[index]}`);
    await saveSprite(spriteIds[index]!, cleaned, {
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
  await renderUiIcons(destination);
}

await main();
