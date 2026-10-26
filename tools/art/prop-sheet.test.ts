import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { PREPARED_PROP_SPRITES } from './prepared-assets';
import { cutProps } from './prop-cutter';

const COLUMNS = 4;
const ROWS = 4;

async function loadSheet(): Promise<{ data: Uint8Array; width: number; height: number }> {
  const source = await readFile(new URL('./source/world-props.png', import.meta.url));
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

function bodyComponents(data: Uint8Array, width: number, height: number): number {
  const seen = new Uint8Array(width * height);
  const body = (index: number): boolean => data[index * 4 + 3]! >= 16;
  const reach = 4;
  let components = 0;
  for (let start = 0; start < width * height; start++) {
    if (seen[start] || !body(start)) continue;
    components++;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const index = stack.pop()!;
      const x = index % width;
      const y = (index - x) / width;
      for (let dy = -reach; dy <= reach; dy++)
        for (let dx = -reach; dx <= reach; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (!seen[next] && body(next)) {
            seen[next] = 1;
            stack.push(next);
          }
        }
    }
  }
  return components;
}

describe('world props sheet', () => {
  it('cuts every prop as one sprite with no fragment that belongs to a neighbouring cell', async () => {
    const { data, width, height } = await loadSheet();
    const sprites = cutProps(data, width, height, COLUMNS, ROWS);
    expect(sprites).toHaveLength(PREPARED_PROP_SPRITES.length);
    sprites.forEach((sprite, index) => {
      expect(
        bodyComponents(sprite.data, sprite.width, sprite.height),
        PREPARED_PROP_SPRITES[index],
      ).toBe(1);
    });
  });

  it('keeps props that overhang their nominal grid cell whole', async () => {
    const { data, width, height } = await loadSheet();
    const sprites = cutProps(data, width, height, COLUMNS, ROWS);
    const cellHeight = height / ROWS;
    const tallest = Math.max(...sprites.slice(0, COLUMNS).map((sprite) => sprite.height));
    expect(tallest).toBeGreaterThan(cellHeight * 1.0);
  });
});
