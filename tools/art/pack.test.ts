import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
    const firstOutput = join(dirname(source), 'first');
    const secondOutput = join(dirname(source), 'second');

    const firstManifest = await packSprites(source, firstOutput);
    await packSprites(source, secondOutput);

    const sprite = firstManifest.sprites['terrain/probe'];
    expect(sprite.frames).toHaveLength(2);
    expect(sprite.anchor).toEqual({ x: 2, y: 4 });
    expect(sprite.footprint).toEqual({ width: 1, height: 1 });
    const pageFile = firstManifest.pages[sprite.frames[0].page].file;
    expect(await readFile(join(firstOutput, pageFile))).toEqual(
      await readFile(join(secondOutput, pageFile)),
    );
    expect(await readFile(join(firstOutput, 'manifest.json'), 'utf8')).toBe(
      await readFile(join(secondOutput, 'manifest.json'), 'utf8'),
    );

    const atlas = await sharp(join(firstOutput, pageFile))
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

  it('splits a category that does not fit one 2048px page across pages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencoaster-art-size-'));
    temporaryDirectories.push(root);
    const source = join(root, 'source');
    const output = join(root, 'output');
    await mkdir(source, { recursive: true });
    const frames = Array.from({ length: 80 }, (_, index) => ({
      x: (index % 8) * 256,
      y: Math.floor(index / 8) * 256,
      width: 256,
      height: 256,
    }));
    await sharp({
      create: {
        width: 2048,
        height: 2560,
        channels: 4,
        background: { r: 30, g: 120, b: 40, alpha: 1 },
      },
    })
      .png()
      .toFile(join(source, 'sheet.png'));
    await writeFile(
      join(source, 'sheet.json'),
      JSON.stringify({ frames, anchor: { x: 128, y: 256 }, footprint: { width: 1, height: 1 } }),
    );

    const manifest = await packSprites(source, output);

    expect(manifest.pages.length).toBeGreaterThan(1);
    for (const page of manifest.pages) {
      expect(page.width).toBeLessThanOrEqual(2048);
      expect(page.height).toBeLessThanOrEqual(2048);
      const image = await sharp(join(output, page.file)).metadata();
      expect([image.width, image.height]).toEqual([page.width, page.height]);
    }
    expect(manifest.sprites.sheet.frames).toHaveLength(80);
    expect(manifest.categories.world.pages).toEqual(manifest.pages.map((_, index) => index));
    for (const frame of manifest.sprites.sheet.frames) {
      expect(frame.x + frame.width).toBeLessThanOrEqual(manifest.pages[frame.page].width);
      expect(frame.y + frame.height).toBeLessThanOrEqual(manifest.pages[frame.page].height);
    }
    const placements = manifest.sprites.sheet.frames.map(
      (frame) => `${frame.page}:${frame.x},${frame.y}`,
    );
    expect(new Set(placements).size).toBe(placements.length);
  });

  it('packs each category into its own pages and marks ride categories lazy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencoaster-art-categories-'));
    temporaryDirectories.push(root);
    const source = join(root, 'source');
    const keys = [
      'terrain/grass',
      'people/guest',
      'rides/flat/carousel',
      'rides/transport/log-flume',
      'transport/river-rapids',
      'track/chairlift/flat/view-0/cell-0',
      'rides/coaster/steel/track',
      'rides/coaster/wooden/track',
      'vehicles/car',
    ];
    for (const key of keys) {
      await mkdir(join(source, key, '..'), { recursive: true });
      await sharp({
        create: { width: 8, height: 8, channels: 4, background: { r: 9, g: 9, b: 9, alpha: 1 } },
      })
        .png()
        .toFile(join(source, `${key}.png`));
    }

    const manifest = await packSprites(source, join(root, 'output'));

    expect(manifest.sprites['terrain/grass'].category).toBe('world');
    expect(manifest.sprites['people/guest'].category).toBe('people');
    expect(manifest.sprites['rides/flat/carousel'].category).toBe('flat-rides');
    expect(manifest.sprites['rides/transport/log-flume'].category).toBe('transport');
    expect(manifest.sprites['transport/river-rapids'].category).toBe('transport');
    expect(manifest.sprites['track/chairlift/flat/view-0/cell-0'].category).toBe('track-chairlift');
    expect(manifest.sprites['rides/coaster/steel/track'].category).toBe('coaster-steel');
    expect(manifest.sprites['rides/coaster/wooden/track'].category).toBe('coaster-wooden');
    expect(manifest.categories.world.lazy).toBe(false);
    expect(manifest.categories.people.lazy).toBe(false);
    expect(manifest.categories['coaster-steel'].lazy).toBe(true);
    expect(manifest.categories.vehicles.lazy).toBe(true);
    expect(manifest.categories.transport.lazy).toBe(true);
    expect(manifest.categories['track-chairlift'].lazy).toBe(true);
    const pageOf = (key: string): number => manifest.sprites[key].frames[0].page;
    expect(new Set(keys.map(pageOf)).size).toBe(keys.length);
    for (const key of keys)
      expect(manifest.pages[pageOf(key)].category).toBe(manifest.sprites[key].category);
  });

  it('trims transparent borders of native sprites and shifts the anchor to match', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencoaster-art-trim-'));
    temporaryDirectories.push(root);
    const source = join(root, 'source');
    await mkdir(source, { recursive: true });
    const pixels = Buffer.alloc(16 * 16 * 4);
    for (let y = 4; y < 8; y++)
      for (let x = 6; x < 12; x++) pixels.set([200, 40, 40, 255], (y * 16 + x) * 4);
    await sharp(pixels, { raw: { width: 16, height: 16, channels: 4 } })
      .png()
      .toFile(join(source, 'ride.png'));
    await writeFile(
      join(source, 'ride.json'),
      JSON.stringify({
        frames: [{ x: 0, y: 0, width: 16, height: 16 }],
        anchor: { x: 8, y: 10 },
        footprint: { width: 1, height: 1 },
        native: true,
      }),
    );

    const manifest = await packSprites(source, join(root, 'output'));

    const sprite = manifest.sprites.ride;
    expect([sprite.frames[0].width, sprite.frames[0].height]).toEqual([6, 4]);
    expect(sprite.anchor).toEqual({ x: 2, y: 6 });
  });

  it('keeps browser UI sheets out of the world sprite atlas', async () => {
    const source = await makeFixture();
    await mkdir(join(source, 'ui'), { recursive: true });
    await sharp({
      create: {
        width: 1536,
        height: 1024,
        channels: 4,
        background: { r: 20, g: 30, b: 40, alpha: 1 },
      },
    })
      .png()
      .toFile(join(source, 'ui', 'icons.png'));

    const manifest = await packSprites(source, join(dirname(source), 'output'));

    expect(manifest.sprites['ui/icons']).toBeUndefined();
    expect(manifest.sprites['terrain/probe']).toBeDefined();
  });

  it('passes the native flag through to the manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencoaster-art-native-'));
    temporaryDirectories.push(root);
    const source = join(root, 'source');
    await mkdir(source, { recursive: true });
    await sharp({
      create: { width: 4, height: 4, channels: 4, background: { r: 200, g: 60, b: 20, alpha: 1 } },
    })
      .png()
      .toFile(join(source, 'tile.png'));
    await writeFile(
      join(source, 'tile.json'),
      JSON.stringify({
        frames: [{ x: 0, y: 0, width: 4, height: 4 }],
        anchor: { x: 2, y: 2 },
        footprint: { width: 1, height: 1 },
        native: true,
      }),
    );
    const manifest = await packSprites(source, join(root, 'output'));
    expect(manifest.sprites.tile.native).toBe(true);
  });
});
