import { describe, expect, it } from 'vitest';
import { cutProps } from './prop-cutter';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function sheet(width: number, height: number, rects: Rect[]): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (const rect of rects)
    for (let y = rect.y; y < rect.y + rect.height; y++)
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        const offset = (y * width + x) * 4;
        data.set([200, 100, 50, 255], offset);
      }
  return data;
}

function opaqueCount(sprite: { data: Uint8Array }): number {
  let count = 0;
  for (let i = 3; i < sprite.data.length; i += 4) if (sprite.data[i]! > 0) count++;
  return count;
}

describe('cutProps', () => {
  it('crops each prop to its own bounding box', () => {
    const data = sheet(40, 40, [
      { x: 3, y: 4, width: 6, height: 8 },
      { x: 25, y: 22, width: 5, height: 5 },
    ]);
    const sprites = cutProps(data, 40, 40, 1, 2);
    expect(sprites[0]).toMatchObject({ width: 6, height: 8 });
    expect(sprites[1]).toMatchObject({ width: 5, height: 5 });
  });

  it('keeps a prop that overhangs its nominal cell whole', () => {
    const sprites = cutProps(
      sheet(40, 60, [
        { x: 5, y: 2, width: 10, height: 24 },
        { x: 5, y: 40, width: 10, height: 7 },
      ]),
      40,
      60,
      1,
      2,
    );
    expect(sprites[0]).toMatchObject({ width: 10, height: 24 });
    expect(sprites[1]).toMatchObject({ width: 10, height: 7 });
  });

  it('removes trunk bottoms of the row above that fall inside the next cell', () => {
    const sprites = cutProps(
      sheet(40, 60, [
        { x: 15, y: 2, width: 10, height: 24 },
        { x: 5, y: 40, width: 30, height: 7 },
      ]),
      40,
      60,
      1,
      2,
    );
    expect(sprites[0]).toMatchObject({ width: 10, height: 24 });
    expect(sprites[1]).toMatchObject({ width: 30, height: 7 });
    expect(opaqueCount(sprites[1]!)).toBe(210);
  });

  it('drops isolated specks', () => {
    const sprites = cutProps(
      sheet(40, 20, [
        { x: 5, y: 5, width: 10, height: 10 },
        { x: 35, y: 2, width: 1, height: 1 },
      ]),
      40,
      20,
      1,
      1,
    );
    expect(sprites[0]).toMatchObject({ width: 10, height: 10 });
  });

  it('keeps detached parts that sit close to the main body', () => {
    const sprites = cutProps(
      sheet(40, 20, [
        { x: 5, y: 8, width: 10, height: 10 },
        { x: 8, y: 2, width: 4, height: 3 },
      ]),
      40,
      20,
      1,
      1,
    );
    expect(sprites[0]).toMatchObject({ width: 10, height: 16 });
  });
});
