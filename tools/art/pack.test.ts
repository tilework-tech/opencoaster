import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { packSprites } from './pack';

const temporaryDirectories: string[] = [];

async function makeFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'opencoaster-art-'));
  temporaryDirectories.push(root);
  const source = join(root, 'source');
  await mkdir(join(source, 'terrain'), { recursive: true });
  const pixels = Buffer.alloc(8 * 4 * 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 8; x++) {
      const offset = (y * 8 + x) * 4;
      pixels[offset] = x < 4 ? 220 : 30;
      pixels[offset + 1] = x < 4 ? 20 : 190;
      pixels[offset + 2] = 40;
      pixels[offset + 3] = 255;
    }
  }
  await sharp(pixels, { raw: { width: 8, height: 4, channels: 4 } })
    .png()
    .toFile(join(source, 'terrain', 'probe.png'));
  await writeFile(
    join(source, 'terrain', 'probe.json'),
    JSON.stringify({
      frames: [
        { x: 0, y: 0, width: 4, height: 4 },
        { x: 4, y: 0, width: 4, height: 4 },
      ],
      anchor: { x: 2, y: 4 },
      footprint: { width: 1, height: 1 },
    }),
  );
  return source;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('world art atlas packing', () => {
  it('produces repeatable atlas regions and preserves authored frame metadata', async () => {
    const source = await makeFixture();
    const firstOutput = join(source, 'first');
    const secondOutput = join(source, 'second');

    const firstManifest = await packSprites(source, firstOutput);
    await packSprites(source, secondOutput);

    const sprite = firstManifest.sprites['terrain/probe'];
    expect(sprite.frames).toHaveLength(2);
    expect(sprite.anchor).toEqual({ x: 2, y: 4 });
    expect(sprite.footprint).toEqual({ width: 1, height: 1 });
    expect(await readFile(join(firstOutput, 'atlas.png'))).toEqual(
      await readFile(join(secondOutput, 'atlas.png')),
    );
    expect(await readFile(join(firstOutput, 'manifest.json'), 'utf8')).toBe(
      await readFile(join(secondOutput, 'manifest.json'), 'utf8'),
    );

    const atlas = await sharp(join(firstOutput, 'atlas.png'))
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (const [index, expected] of [
      [0, [220, 20, 40, 255]],
      [1, [30, 190, 40, 255]],
    ] as const) {
      const frame = sprite.frames[index];
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.y).toBeGreaterThanOrEqual(0);
      expect(frame.x + frame.width).toBeLessThanOrEqual(atlas.info.width);
      expect(frame.y + frame.height).toBeLessThanOrEqual(atlas.info.height);
      const offset = (frame.y * atlas.info.width + frame.x) * atlas.info.channels;
      expect([...atlas.data.subarray(offset, offset + 4)]).toEqual(expected);
      expect(frame.width).toBe(4);
      expect(frame.height).toBe(4);
    }
  });

  it('keeps generated atlas width within the space reserved for the renderer fallback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencoaster-art-size-'));
    temporaryDirectories.push(root);
    const source = join(root, 'source');
    const output = join(root, 'output');
    await mkdir(source, { recursive: true });
    const frames = Array.from({ length: 65 }, (_, index) => ({
      x: (index % 8) * 128,
      y: Math.floor(index / 8) * 128,
      width: 128,
      height: 128,
    }));
    await sharp({
      create: {
        width: 1024,
        height: 1152,
        channels: 4,
        background: { r: 30, g: 120, b: 40, alpha: 1 },
      },
    })
      .png()
      .toFile(join(source, 'sheet.png'));
    await writeFile(
      join(source, 'sheet.json'),
      JSON.stringify({
        frames,
        anchor: { x: 64, y: 128 },
        footprint: { width: 1, height: 1 },
      }),
    );

    const manifest = await packSprites(source, output);
    expect(manifest.width).toBeLessThanOrEqual(2048);
    expect(manifest.height).toBeLessThanOrEqual(4096);
    expect(manifest.sprites.sheet.frames).toHaveLength(65);
  });

  it('stores frames with identical pixels once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencoaster-art-dedupe-'));
    temporaryDirectories.push(root);
    const source = join(root, 'source');
    await mkdir(source, { recursive: true });
    for (const name of ['a', 'b']) {
      await sharp({
        create: {
          width: 6,
          height: 6,
          channels: 4,
          background: { r: 200, g: 60, b: 20, alpha: 1 },
        },
      })
        .png()
        .toFile(join(source, `${name}.png`));
    }
    const manifest = await packSprites(source, join(root, 'output'));
    expect(manifest.sprites.a.frames[0]).toEqual(manifest.sprites.b.frames[0]);
  });
});
