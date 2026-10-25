import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import sharp from 'sharp';

const MAX_ATLAS_WIDTH = 1024;
const MAX_ATLAS_HEIGHT = 2048;

export interface SpriteFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpriteMetadata {
  frames: SpriteFrame[];
  anchor: { x: number; y: number };
  footprint: { width: number; height: number };
  /** Drawn at its frame size with the anchor on the projected point, not stretched to a quad. */
  native?: boolean;
}

export interface AtlasManifest {
  width: number;
  height: number;
  sprites: Record<string, SpriteMetadata>;
}

interface SourceFrame {
  key: string;
  spriteKey: string;
  frameIndex: number;
  sourcePath: string;
  region: SpriteFrame;
}

interface PackedFrame extends SourceFrame {
  x: number;
  y: number;
}

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

async function listPngs(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? listPngs(path)
        : Promise.resolve(
            entry.isFile() && entry.name.endsWith('.png') && entry.name !== 'atlas.png'
              ? [path]
              : [],
          );
    }),
  );
  return files.flat().sort((left, right) => left.localeCompare(right));
}

function normalizeKey(path: string): string {
  return path.split(sep).join('/');
}

function validateRegion(region: SpriteFrame, width: number, height: number, file: string): void {
  const values = [region.x, region.y, region.width, region.height];
  if (
    !values.every(Number.isInteger) ||
    region.x < 0 ||
    region.y < 0 ||
    region.width <= 0 ||
    region.height <= 0 ||
    region.x + region.width > width ||
    region.y + region.height > height
  ) {
    throw new Error(`Invalid frame region in ${file}`);
  }
}

async function loadSprites(inputDir: string): Promise<{
  frames: SourceFrame[];
  metadata: Map<string, Omit<SpriteMetadata, 'frames'>>;
}> {
  const files = (await listPngs(inputDir)).filter(
    (file) => normalizeKey(relative(inputDir, file)).split('/')[0] !== 'ui',
  );
  const frames: SourceFrame[] = [];
  const metadata = new Map<string, Omit<SpriteMetadata, 'frames'>>();

  for (const file of files) {
    const pngRelative = relative(inputDir, file);
    const spriteKey = normalizeKey(pngRelative.slice(0, -4));
    const metadataPath = join(dirname(file), `${basename(file, '.png')}.json`);
    const { width, height } = await sharp(file).metadata();
    if (!width || !height) throw new Error(`Could not read image dimensions for ${file}`);

    let authored: SpriteMetadata;
    try {
      authored = JSON.parse(await readFile(metadataPath, 'utf8')) as SpriteMetadata;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      authored = {
        frames: [{ x: 0, y: 0, width, height }],
        anchor: { x: Math.floor(width / 2), y: height },
        footprint: { width: 1, height: 1 },
      };
    }

    if (
      !Array.isArray(authored.frames) ||
      authored.frames.length === 0 ||
      !Number.isFinite(authored.anchor?.x) ||
      !Number.isFinite(authored.anchor?.y) ||
      !Number.isFinite(authored.footprint?.width) ||
      !Number.isFinite(authored.footprint?.height) ||
      authored.footprint.width <= 0 ||
      authored.footprint.height <= 0
    ) {
      throw new Error(`Invalid sprite metadata in ${metadataPath}`);
    }

    metadata.set(spriteKey, {
      anchor: authored.anchor,
      footprint: authored.footprint,
      ...(authored.native ? { native: true } : {}),
    });
    authored.frames.forEach((region, frameIndex) => {
      validateRegion(region, width, height, metadataPath);
      frames.push({
        key: `${spriteKey}\u0000${String(frameIndex).padStart(6, '0')}`,
        spriteKey,
        frameIndex,
        sourcePath: file,
        region,
      });
    });
  }

  return { frames, metadata };
}

/** Pack PNG sprites and their authored JSON frame metadata into a deterministic atlas. */
export async function packSprites(inputDir: string, outputDir: string): Promise<AtlasManifest> {
  const { frames: sourceFrames, metadata: sourceMetadata } = await loadSprites(inputDir);
  if (sourceFrames.length === 0) throw new Error(`No PNG sprites found in ${inputDir}`);

  const sorted = [...sourceFrames].sort((left, right) => {
    const areaOrder =
      right.region.height * right.region.width - left.region.height * left.region.width;
    return (
      areaOrder ||
      right.region.height - left.region.height ||
      right.region.width - left.region.width ||
      left.key.localeCompare(right.key)
    );
  });
  const totalArea = sorted.reduce(
    (sum, frame) => sum + frame.region.width * frame.region.height,
    0,
  );
  const widest = Math.max(...sorted.map((frame) => frame.region.width));
  const atlasWidth = Math.min(
    MAX_ATLAS_WIDTH,
    nextPowerOfTwo(Math.max(widest, Math.ceil(Math.sqrt(totalArea)))),
  );
  if (widest > atlasWidth)
    throw new Error(`Sprite width ${widest} exceeds the ${MAX_ATLAS_WIDTH}px atlas width limit`);
  const packed: PackedFrame[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let shelfHeight = 0;

  for (const frame of sorted) {
    if (cursorX + frame.region.width > atlasWidth) {
      cursorX = 0;
      cursorY += shelfHeight;
      shelfHeight = 0;
    }
    packed.push({ ...frame, x: cursorX, y: cursorY });
    cursorX += frame.region.width;
    shelfHeight = Math.max(shelfHeight, frame.region.height);
  }

  const atlasHeight = nextPowerOfTwo(cursorY + shelfHeight);
  if (atlasHeight > MAX_ATLAS_HEIGHT)
    throw new Error(`Packed atlas height ${atlasHeight} exceeds the ${MAX_ATLAS_HEIGHT}px limit`);
  const composites = await Promise.all(
    packed.map(async (frame) => ({
      input: await sharp(frame.sourcePath)
        .extract({
          left: frame.region.x,
          top: frame.region.y,
          width: frame.region.width,
          height: frame.region.height,
        })
        .ensureAlpha()
        .png({ compressionLevel: 9, adaptiveFiltering: false })
        .toBuffer(),
      left: frame.x,
      top: frame.y,
    })),
  );
  await mkdir(outputDir, { recursive: true });
  await sharp({
    create: {
      width: atlasWidth,
      height: atlasHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toFile(join(outputDir, 'atlas.png'));

  const atlasFrames = new Map<string, SpriteFrame>();
  for (const frame of packed) {
    atlasFrames.set(`${frame.spriteKey}\u0000${String(frame.frameIndex).padStart(6, '0')}`, {
      x: frame.x,
      y: frame.y,
      width: frame.region.width,
      height: frame.region.height,
    });
  }

  const sprites = Object.fromEntries(
    [...sourceMetadata.keys()]
      .sort((left, right) => left.localeCompare(right))
      .map((spriteKey) => [
        spriteKey,
        {
          frames: sourceFrames
            .filter((frame) => frame.spriteKey === spriteKey)
            .sort((left, right) => left.frameIndex - right.frameIndex)
            .map((frame) => atlasFrames.get(frame.key)!),
          ...sourceMetadata.get(spriteKey)!,
        },
      ]),
  );
  const manifest: AtlasManifest = { width: atlasWidth, height: atlasHeight, sprites };
  await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
