import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { PALETTE } from './palette';
import { TRANSPARENT } from './raster';
import type { Sprite } from './raster';

export interface SpriteDef {
  /** Manifest key, e.g. `paths/tarmac/connection-05`. */
  key: string;
  /** Animation frames, all sharing size and anchor. */
  frames: Sprite[];
  footprint: { width: number; height: number };
  /** Keep frames exactly as rendered instead of padding to a centred anchor (for square textures). */
  raw?: boolean;
}

/** Pads sprites onto a shared canvas so every frame of a set has the same size and anchor. */
export function alignFrames(frames: readonly Sprite[]): Sprite[] {
  const left = Math.max(...frames.map((f) => f.anchor.x));
  const right = Math.max(...frames.map((f) => f.width - f.anchor.x));
  const up = Math.max(...frames.map((f) => f.anchor.y));
  const down = Math.max(...frames.map((f) => f.height - f.anchor.y));
  const half = Math.max(left, right);
  const height = up + down + ((up + down) % 2);
  return frames.map((f) => {
    const pixels = new Uint8Array(half * 2 * height).fill(TRANSPARENT);
    const heights = f.heights ? new Float32Array(half * 2 * height).fill(NaN) : undefined;
    const ox = half - f.anchor.x;
    const oy = height - down - f.anchor.y;
    for (let y = 0; y < f.height; y++)
      for (let x = 0; x < f.width; x++) {
        pixels[(y + oy) * half * 2 + x + ox] = f.pixels[y * f.width + x];
        if (heights) heights[(y + oy) * half * 2 + x + ox] = f.heights![y * f.width + x];
      }
    return {
      width: half * 2,
      height,
      anchor: { x: half, y: height - down },
      pixels,
      ...(heights ? { heights } : {}),
    };
  });
}

export function toRgba(sprite: Sprite): Buffer {
  const out = Buffer.alloc(sprite.width * sprite.height * 4);
  sprite.pixels.forEach((p, i) => {
    if (p === TRANSPARENT) return;
    const [r, g, b] = PALETTE[p];
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  });
  return out;
}

/** Writes a PNG strip (frames stacked vertically) plus its JSON metadata, as `tools/art` does. */
export async function writeSpriteDef(outputDir: string, def: SpriteDef): Promise<void> {
  const frames = def.raw ? def.frames : alignFrames(def.frames);
  const { width, height, anchor } = frames[0];
  const strip = Buffer.alloc(width * height * frames.length * 4);
  frames.forEach((f, i) => toRgba(f).copy(strip, i * width * height * 4));
  const target = join(outputDir, `${def.key}.png`);
  await mkdir(dirname(target), { recursive: true });
  await sharp(strip, { raw: { width, height: height * frames.length, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toFile(target);
  const metadata = {
    frames: frames.map((_, i) => ({ x: 0, y: i * height, width, height })),
    anchor,
    footprint: def.footprint,
    ...(def.raw ? {} : { native: true }),
  };
  await writeFile(target.replace(/\.png$/, '.json'), `${JSON.stringify(metadata, null, 2)}\n`);
}

/** Lays frame 0 of each sprite on a dark sheet (shelf layout) at an integer scale for review. */
export async function contactSheet(
  defs: readonly SpriteDef[],
  options: { width: number; scale: number; background?: [number, number, number] },
): Promise<Buffer> {
  const frames = defs.map((d) => alignFrames(d.frames)[0]);
  const pad = 3;
  const placements: Array<{ x: number; y: number }> = [];
  let cursorX = 0;
  let cursorY = 0;
  let shelf = 0;
  for (const f of frames) {
    if (cursorX + f.width + pad > options.width) {
      cursorX = 0;
      cursorY += shelf + pad;
      shelf = 0;
    }
    placements.push({ x: cursorX + pad, y: cursorY + pad });
    cursorX += f.width + pad;
    shelf = Math.max(shelf, f.height);
  }
  const width = options.width + pad;
  const height = cursorY + shelf + pad * 2;
  const bg = options.background ?? [38, 34, 40];
  const sheet = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    sheet[i * 4] = bg[0];
    sheet[i * 4 + 1] = bg[1];
    sheet[i * 4 + 2] = bg[2];
    sheet[i * 4 + 3] = 255;
  }
  frames.forEach((f, i) => {
    const { x: ox, y: oy } = placements[i];
    const rgba = toRgba(f);
    for (let y = 0; y < f.height; y++)
      for (let x = 0; x < f.width; x++) {
        const s = (y * f.width + x) * 4;
        if (rgba[s + 3] === 0) continue;
        const d = ((oy + y) * width + ox + x) * 4;
        sheet[d] = rgba[s];
        sheet[d + 1] = rgba[s + 1];
        sheet[d + 2] = rgba[s + 2];
      }
  });
  return sharp(sheet, { raw: { width, height, channels: 4 } })
    .resize({ width: width * options.scale, height: height * options.scale, kernel: 'nearest' })
    .png()
    .toBuffer();
}
