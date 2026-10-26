import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import sharp from 'sharp';
import { categoryForSprite } from './categories';
import { MaxRectsBin } from './maxrects';

/** Largest page edge; 2048 is safe on mobile GPUs. */
export const MAX_PAGE_SIZE = 2048;
/** Transparent gutter between packed frames to prevent neighbouring texels from bleeding in scaled draws. */
export const SPRITE_PADDING = 2;
/** Directory under the sprite output holding the page PNGs; excluded from packer input. */
export const ATLAS_PAGE_DIRECTORY = 'atlas';

export interface SpriteFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PackedSpriteFrame extends SpriteFrame {
  /** Index into `AtlasManifest.pages`. */
  page: number;
}

export interface SpriteMetadata {
  frames: SpriteFrame[];
  anchor: { x: number; y: number };
  footprint: { width: number; height: number };
  /** Drawn at its frame size with the anchor on the projected point, not stretched to a quad. */
  native?: boolean;
}

export interface AtlasPage {
  /** PNG path relative to the manifest. */
  file: string;
  width: number;
  height: number;
  category: string;
}

export interface AtlasCategory {
  /** Lazy categories load the first time one of their sprites is wanted. */
  lazy: boolean;
  /** Indices into `pages`. */
  pages: number[];
}

export interface PackedSpriteMetadata extends Omit<SpriteMetadata, 'frames'> {
  category: string;
  frames: PackedSpriteFrame[];
}

export interface AtlasManifest {
  pages: AtlasPage[];
  categories: Record<string, AtlasCategory>;
  sprites: Record<string, PackedSpriteMetadata>;
}

interface SourceFrame {
  key: string;
  spriteKey: string;
  frameIndex: number;
  sourcePath: string;
  region: SpriteFrame;
}

interface PackedFrame extends SourceFrame {
  page: number;
  x: number;
  y: number;
}

function roundUp(value: number, multiple: number): number {
  return Math.ceil(value / multiple) * multiple;
}

async function listPngs(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? listPngs(path)
        : Promise.resolve(entry.isFile() && entry.name.endsWith('.png') ? [path] : []);
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

/**
 * Smallest box, in frame-local pixels, that holds every non-transparent pixel of all frames.
 * Returns null when the frames differ in size (the shared box would not be meaningful), when the
 * box is the whole frame, or when every pixel is transparent.
 */
async function opaqueBounds(
  file: string,
  regions: readonly SpriteFrame[],
): Promise<{ left: number; top: number; width: number; height: number } | null> {
  const { width: frameWidth, height: frameHeight } = regions[0];
  if (regions.some((region) => region.width !== frameWidth || region.height !== frameHeight))
    return null;
  const image = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = frameWidth;
  let top = frameHeight;
  let right = -1;
  let bottom = -1;
  for (const region of regions) {
    for (let y = 0; y < frameHeight; y++) {
      for (let x = 0; x < frameWidth; x++) {
        const offset = ((region.y + y) * image.info.width + region.x + x) * 4;
        if (image.data[offset + 3] === 0) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }
  if (right < left || bottom < top) return null;
  if (left === 0 && top === 0 && right === frameWidth - 1 && bottom === frameHeight - 1)
    return null;
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

async function loadSprites(inputDir: string): Promise<{
  frames: SourceFrame[];
  metadata: Map<string, Omit<SpriteMetadata, 'frames'>>;
}> {
  const files = (await listPngs(inputDir)).filter(
    (file) =>
      !['ui', ATLAS_PAGE_DIRECTORY].includes(normalizeKey(relative(inputDir, file)).split('/')[0]),
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

    authored.frames.forEach((region) => validateRegion(region, width, height, metadataPath));
    const trim = authored.native ? await opaqueBounds(file, authored.frames) : null;
    const regions = trim
      ? authored.frames.map((region) => ({
          x: region.x + trim.left,
          y: region.y + trim.top,
          width: trim.width,
          height: trim.height,
        }))
      : authored.frames;
    metadata.set(spriteKey, {
      anchor: trim
        ? { x: authored.anchor.x - trim.left, y: authored.anchor.y - trim.top }
        : authored.anchor,
      footprint: authored.footprint,
      ...(authored.native ? { native: true } : {}),
    });
    regions.forEach((region, frameIndex) => {
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

/** Pack PNG sprites and their authored JSON frame metadata into deterministic per-category pages. */
export async function packSprites(inputDir: string, outputDir: string): Promise<AtlasManifest> {
  const { frames: sourceFrames, metadata: sourceMetadata } = await loadSprites(inputDir);
  if (sourceFrames.length === 0) throw new Error(`No PNG sprites found in ${inputDir}`);

  const categories = new Map<string, { lazy: boolean; frames: SourceFrame[] }>();
  const spriteCategory = new Map<string, string>();
  for (const spriteKey of sourceMetadata.keys()) {
    const { name, lazy } = categoryForSprite(spriteKey);
    spriteCategory.set(spriteKey, name);
    if (!categories.has(name)) categories.set(name, { lazy, frames: [] });
  }
  for (const frame of sourceFrames)
    categories.get(spriteCategory.get(frame.spriteKey)!)!.frames.push(frame);

  const pages: AtlasPage[] = [];
  const pageFrames: PackedFrame[][] = [];
  const manifestCategories: Record<string, AtlasCategory> = {};
  for (const name of [...categories.keys()].sort((left, right) => left.localeCompare(right))) {
    const { lazy, frames } = categories.get(name)!;
    const sorted = [...frames].sort(
      (left, right) =>
        right.region.height * right.region.width - left.region.height * left.region.width ||
        right.region.height - left.region.height ||
        right.region.width - left.region.width ||
        left.key.localeCompare(right.key),
    );
    const bins: { bin: MaxRectsBin; frames: PackedFrame[]; width: number; height: number }[] = [];
    for (const frame of sorted) {
      if (
        frame.region.width + SPRITE_PADDING * 2 > MAX_PAGE_SIZE ||
        frame.region.height + SPRITE_PADDING * 2 > MAX_PAGE_SIZE
      )
        throw new Error(
          `Sprite ${frame.spriteKey} (${frame.region.width}x${frame.region.height}) exceeds the ` +
            `${MAX_PAGE_SIZE}px page limit`,
        );
      let placed = null;
      const paddedWidth = frame.region.width + SPRITE_PADDING * 2;
      const paddedHeight = frame.region.height + SPRITE_PADDING * 2;
      let target = bins.find((candidate) => {
        placed = candidate.bin.insert(paddedWidth, paddedHeight);
        return placed !== null;
      });
      if (!target) {
        target = {
          bin: new MaxRectsBin(MAX_PAGE_SIZE, MAX_PAGE_SIZE),
          frames: [],
          width: 0,
          height: 0,
        };
        bins.push(target);
        placed = target.bin.insert(paddedWidth, paddedHeight);
      }
      const rect = placed!;
      target.frames.push({
        ...frame,
        page: -1,
        x: rect.x + SPRITE_PADDING,
        y: rect.y + SPRITE_PADDING,
      });
      target.width = Math.max(target.width, rect.x + paddedWidth);
      target.height = Math.max(target.height, rect.y + paddedHeight);
    }
    manifestCategories[name] = { lazy, pages: [] };
    bins.forEach((entry, binIndex) => {
      const page = pages.length;
      manifestCategories[name].pages.push(page);
      pages.push({
        file: `${ATLAS_PAGE_DIRECTORY}/${name}-${binIndex}.png`,
        width: roundUp(entry.width, 4),
        height: roundUp(entry.height, 4),
        category: name,
      });
      pageFrames.push(entry.frames.map((frame) => ({ ...frame, page })));
    });
  }

  await rm(join(outputDir, ATLAS_PAGE_DIRECTORY), { recursive: true, force: true });
  await mkdir(join(outputDir, ATLAS_PAGE_DIRECTORY), { recursive: true });
  await Promise.all(
    pages.map(async (page, index) => {
      const composites = await Promise.all(
        pageFrames[index].map(async (frame) => ({
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
      await sharp({
        create: {
          width: page.width,
          height: page.height,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite(composites)
        .png({ compressionLevel: 9, adaptiveFiltering: false })
        .toFile(join(outputDir, page.file));
    }),
  );

  const atlasFrames = new Map<string, PackedSpriteFrame>();
  for (const frame of pageFrames.flat()) {
    atlasFrames.set(frame.key, {
      page: frame.page,
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
          category: spriteCategory.get(spriteKey)!,
          frames: sourceFrames
            .filter((frame) => frame.spriteKey === spriteKey)
            .sort((left, right) => left.frameIndex - right.frameIndex)
            .map((frame) => atlasFrames.get(frame.key)!),
          ...sourceMetadata.get(spriteKey)!,
        },
      ]),
  );
  const manifest: AtlasManifest = { pages, categories: manifestCategories, sprites };
  await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
