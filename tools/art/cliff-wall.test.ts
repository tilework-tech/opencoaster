import { describe, expect, it } from 'vitest';
import { earthWallPatch } from './cliff-wall';

function sprite(width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const grassTop = y < 10;
      const edge = x < 2;
      data.set(grassTop ? [60, 160, 40, 255] : [140, 100, 60, 255], offset);
      if (edge) data[offset + 3] = 0;
    }
  return data;
}

describe('earthWallPatch', () => {
  it('returns a fully opaque patch taken from the earth, not the grass or transparent edge', () => {
    const patch = earthWallPatch({ data: sprite(40, 40), width: 40, height: 40 });
    for (let i = 0; i < patch.data.length; i += 4) {
      expect(patch.data[i + 3]).toBe(255);
      expect([...patch.data.subarray(i, i + 3)]).toEqual([140, 100, 60]);
    }
  });

  it('refuses a sprite with no opaque region large enough', () => {
    expect(() =>
      earthWallPatch({ data: new Uint8Array(40 * 40 * 4), width: 40, height: 40 }),
    ).toThrow();
  });
});
