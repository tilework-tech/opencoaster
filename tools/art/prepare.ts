import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import sharp from 'sharp';
import { defringeRgba } from './image-cleanup';

const sourceDirectory = new URL('./source/', import.meta.url);
const outputDirectory = new URL('../../public/sprites/', import.meta.url);
const PATH_SPRITE_SIZE = 96;

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

async function recolorPath(
  source: Buffer,
  style: 'crazy-paving' | 'dirt' | 'queue',
): Promise<Buffer> {
  const { data, info } = await sharp(source)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) continue;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    if (red <= green + 12 || green <= blue + 10 || red < 80) continue;

    if (style === 'crazy-paving') {
      const gray = Math.round(red * 0.25 + green * 0.58 + blue * 0.17);
      const pixel = (offset / 4) | 0;
      const x = pixel % info.width;
      const y = Math.floor(pixel / info.width);
      const seam = (x * 13 + y * 7) % 47 === 0;
      data[offset] = seam ? Math.round(gray * 0.58) : Math.round(gray * 0.91);
      data[offset + 1] = seam ? Math.round(gray * 0.62) : Math.round(gray * 0.94);
      data[offset + 2] = seam ? Math.round(gray * 0.68) : Math.round(gray * 0.88);
    } else if (style === 'dirt') {
      data[offset] = Math.min(255, Math.round(red * 0.7 + 28));
      data[offset + 1] = Math.round(green * 0.55 + 15);
      data[offset + 2] = Math.round(blue * 0.4 + 10);
    } else {
      data[offset] = Math.min(255, Math.round(red * 0.94 + 18));
      data[offset + 1] = Math.round(green * 0.68);
      data[offset + 2] = Math.round(blue * 0.7 + 6);
    }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
}

async function rampImage(source: Buffer, direction: number): Promise<Buffer> {
  const { data, info } = await sharp(source)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rise = 12;
  const outputHeight = info.height + rise;
  const output = Buffer.alloc(info.width * outputHeight * 4);
  const alongWidth = direction < 2;
  const reverse = direction === 1 || direction === 3;
  const extent = alongWidth ? info.width : info.height;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const sourceOffset = (y * info.width + x) * 4;
      if (data[sourceOffset + 3] === 0) continue;
      const progress = (alongWidth ? x : y) / Math.max(1, extent - 1);
      const displacement = Math.round((reverse ? progress : 1 - progress) * rise);
      const targetOffset = ((y + displacement) * info.width + x) * 4;
      data.copy(output, targetOffset, sourceOffset, sourceOffset + 4);
    }
  }
  const shifted = await sharp(output, {
    raw: { width: info.width, height: outputHeight, channels: 4 },
  })
    .png()
    .toBuffer();
  return cell(shifted, { x: 0, y: 0, width: info.width, height: outputHeight });
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

async function saveAnimation(spriteId: string, images: Buffer[], info: SpriteInfo): Promise<void> {
  const sizes = await Promise.all(images.map((image) => sharp(image).metadata()));
  const frameWidth = Math.max(...sizes.map((size) => size.width ?? 0));
  const frameHeight = Math.max(...sizes.map((size) => size.height ?? 0));
  const frameCanvases = await Promise.all(
    images.map((image, index) =>
      sharp({
        create: {
          width: frameWidth,
          height: frameHeight,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite([{ input: image, gravity: 'centre' }])
        .png({
          palette: true,
          colors: 64,
          dither: 0,
          compressionLevel: 9,
          adaptiveFiltering: false,
        })
        .toBuffer()
        .then((input) => ({ input, left: 0, top: index * frameHeight })),
    ),
  );
  const targetPath = outputPath(spriteId).pathname;
  await mkdir(dirname(targetPath), { recursive: true });
  await sharp({
    create: {
      width: frameWidth,
      height: frameHeight * images.length,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(frameCanvases)
    .png({ palette: true, colors: 64, dither: 0, compressionLevel: 9, adaptiveFiltering: false })
    .toFile(targetPath);
  const metadata: SpriteInfo = {
    anchor: { x: Math.floor(frameWidth / 2), y: frameHeight },
    footprint: info.footprint,
  };
  await writeFile(
    targetPath.replace(/\.png$/, '.json'),
    `${JSON.stringify(
      {
        frames: images.map((_, index) => ({
          x: 0,
          y: index * frameHeight,
          width: frameWidth,
          height: frameHeight,
        })),
        ...metadata,
      },
      null,
      2,
    )}\n`,
  );
}

async function prepareTerrain(): Promise<void> {
  const source = await readFile(new URL('terrain-shapes.png', sourceDirectory));
  const { width, height } = await sharp(source).metadata();
  if (!width || !height) throw new Error('Could not read terrain sheet dimensions');
  const materials = ['grass', 'sand', 'dirt', 'rock'];
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

async function preparePaths(): Promise<void> {
  const source = await readFile(new URL('path-connections.png', sourceDirectory));
  const { width, height } = await sharp(source).metadata();
  if (!width || !height) throw new Error('Could not read path connection sheet dimensions');
  const connections = await Promise.all(
    Array.from({ length: 16 }, async (_, connection) => {
      const image = await cell(
        source,
        gridBounds(width, height, 4, 4, connection % 4, Math.floor(connection / 4)),
      );
      return cleanedImage(image, PATH_SPRITE_SIZE);
    }),
  );
  const styles: Array<'tarmac' | 'crazy-paving' | 'dirt' | 'queue'> = [
    'tarmac',
    'crazy-paving',
    'dirt',
    'queue',
  ];
  for (const style of styles) {
    const styleConnections = await Promise.all(
      connections.map((image) =>
        style === 'tarmac' ? Promise.resolve(image) : recolorPath(image, style),
      ),
    );
    for (let connection = 0; connection < styleConnections.length; connection++) {
      const cleaned = await cleanedImage(styleConnections[connection], PATH_SPRITE_SIZE);
      const dimensions = await sharp(cleaned).metadata();
      const spriteId = `paths/${style}/connection-${String(connection).padStart(2, '0')}`;
      if (!dimensions.width || !dimensions.height)
        throw new Error(`Could not read cleaned path sprite ${spriteId}`);
      await saveSprite(spriteId, cleaned, {
        anchor: { x: Math.floor(dimensions.width / 2), y: dimensions.height },
        footprint: { width: 1, height: 1 },
      });
    }

    for (let direction = 0; direction < 4; direction++) {
      const ramp = await cleanedImage(
        await rampImage(styleConnections[1 << direction], direction),
        PATH_SPRITE_SIZE,
      );
      const dimensions = await sharp(ramp).metadata();
      const spriteId = `paths/${style}/ramp-${String(direction).padStart(2, '0')}`;
      if (!dimensions.width || !dimensions.height)
        throw new Error(`Could not read cleaned path ramp ${spriteId}`);
      await saveSprite(spriteId, ramp, {
        anchor: { x: Math.floor(dimensions.width / 2), y: dimensions.height },
        footprint: { width: 1, height: 1 },
      });
    }
  }
}

async function prepareWater(): Promise<void> {
  const source = await readFile(new URL('water-animation.png', sourceDirectory));
  const { width, height } = await sharp(source).metadata();
  if (!width || !height) throw new Error('Could not read water animation dimensions');
  const frames: Buffer[] = [];
  for (let frame = 0; frame < 4; frame++) {
    const image = await cell(source, gridBounds(width, height, 4, 1, frame, 0));
    frames.push(await opaqueTexture(image, 32, frame + 10));
  }
  await saveAnimation('water/surface', frames, {
    anchor: { x: 0, y: 0 },
    footprint: { width: 1, height: 1 },
  });
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

async function prepareUi(): Promise<void> {
  const source = await readFile(new URL('ui-icons.png', sourceDirectory));
  const cleaned = await cleanedImage(source, 1024);
  const destination = new URL('../../public/sprites/ui/icons.png', import.meta.url);
  await mkdir(dirname(destination.pathname), { recursive: true });
  await writeFile(destination, cleaned);
}

async function main(): Promise<void> {
  const destination = outputDirectory.pathname;
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await Promise.all([
    prepareTerrain(),
    preparePaths(),
    prepareWater(),
    prepareProps(),
    prepareUi(),
  ]);
}

await main();
