import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

describe('sprite sheet processing', () => {
  it('writes a transparent 4 by 4 sheet and frame metadata from generated source art', async () => {
    const output = mkdtempSync(join(tmpdir(), 'opencoaster-art-'));
    const imagePath = join(output, 'characters', 'guest-walk.png');
    const metadataPath = join(output, 'characters', 'guest-walk.json');
    const maskPath = join(output, 'palette-mask.png');

    try {
      execFileSync(
        process.execPath,
        [
          'node_modules/tsx/dist/cli.mjs',
          'tools/art/process-sprites.ts',
          '--input',
          'tools/art/source/guest-walk.png',
          '--output',
          imagePath,
          '--name',
          'guest-walk',
          '--columns',
          '4',
          '--rows',
          '4',
          '--cell-size',
          '16',
          '--mask-output',
          maskPath,
        ],
        { stdio: 'pipe' },
      );

      const png = readFileSync(imagePath);
      const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as {
        anchor: { x: number; y: number };
        footprint: { width: number; height: number };
        frames: Array<{
          direction: string;
          height: number;
          index: number;
          tint: number;
          walkingFrame: number;
          width: number;
          x: number;
          y: number;
        }>;
        image: { height: number; width: number };
      };
      expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(png.readUInt32BE(16)).toBe(256);
      expect(png.readUInt32BE(20)).toBe(128);
      expect(png[25]).toBe(6);
      const { data: pixels } = await sharp(imagePath)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(pixels.some((_, offset) => offset % 4 === 3 && pixels[offset] === 0)).toBe(true);
      expect(pixels.some((_, offset) => offset % 4 === 3 && pixels[offset] === 255)).toBe(true);
      expect(metadata.image).toEqual({ width: 256, height: 128 });
      expect(metadata.anchor).toEqual({ x: 8, y: 16 });
      expect(metadata.footprint).toEqual({ width: 1, height: 1 });
      expect(metadata.frames).toHaveLength(128);
      expect(metadata.frames[0]).toEqual({
        x: 0,
        y: 0,
        width: 16,
        height: 16,
        index: 0,
        direction: 'front',
        tint: 0,
        walkingFrame: 0,
      });
      expect(existsSync(maskPath)).toBe(true);
      expect(existsSync(join(output, 'characters', 'guest-walk-mask.png'))).toBe(false);
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  });
});
