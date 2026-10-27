import { describe, expect, it } from 'vitest';
import { encodeHeight } from './height-encoding';
import { DepthComposite, compositeFrame } from './depth-composite';
import { compositeScene } from './occlusion-oracle';
import type { OraclePage, OracleSprite, OracleTriangle } from './occlusion-oracle';

/** A page holding one opaque frame whose pixels all stand `height(x, y)` levels above the anchor. */
function page(
  width: number,
  height: number,
  heightAt: (x: number, y: number) => number,
  rgba: readonly [number, number, number, number] = [200, 100, 50, 255],
): OraclePage {
  const colour = new Uint8ClampedArray(width * height * 4);
  const heights = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      colour.set(rgba, at);
      const [hi, lo] = encodeHeight(heightAt(x, y));
      heights[at] = hi;
      heights[at + 1] = lo;
      heights[at + 3] = 255;
    }
  return { width, height, colour, heights };
}

function sprite(id: number, pageIndex: number, p: OraclePage, at: Partial<OracleSprite> = {}) {
  return {
    id,
    page: pageIndex,
    frame: { x: 0, y: 0, width: p.width, height: p.height },
    left: 0,
    top: 0,
    width: p.width,
    height: p.height,
    anchorHeight: 0,
    heightScale: 1,
    ...at,
  } satisfies OracleSprite;
}

function composite(width: number, height: number, ground: readonly OracleTriangle[] = []) {
  const target = new DepthComposite();
  target.begin(width, height, new Uint8ClampedArray(width * height * 4), true);
  target.ground(ground);
  return target;
}

function draw(target: DepthComposite, pages: readonly OraclePage[], s: OracleSprite, alpha = 1) {
  target.sprite(compositeFrame(pages[s.page]!, s.frame), s, alpha);
}

describe('DepthComposite', () => {
  it('keeps the higher surface at each pixel whatever the draw order', () => {
    const low = page(4, 4, () => 0);
    const high = page(4, 4, () => 1);
    for (const order of [
      [0, 1],
      [1, 0],
    ]) {
      const target = composite(4, 4);
      const sprites = [sprite(10, 0, low), sprite(11, 1, high)];
      for (const index of order) draw(target, [low, high], sprites[index]!);
      expect([...target.ids!]).toEqual(new Array(16).fill(11));
    }
  });

  it('gives a tie to the sprite drawn later', () => {
    const p = page(2, 2, () => 0.5);
    const target = composite(2, 2);
    draw(target, [p], sprite(1, 0, p));
    draw(target, [p], sprite(2, 0, p));
    expect([...target.ids!]).toEqual([2, 2, 2, 2]);
  });

  it('adds the anchor height and scales baked heights with the drawn size', () => {
    const tall = page(2, 2, () => 1);
    const target = composite(4, 4);
    draw(target, [tall], sprite(1, 0, tall, { width: 4, height: 4, heightScale: 2 }));
    draw(target, [tall], sprite(2, 0, tall, { width: 4, height: 4, anchorHeight: 1.5 }));
    // The first stands 0 + 1 * 2 = 2 levels high, the second 1.5 + 1 = 2.5.
    expect(target.ids![0]).toBe(2);
    expect(target.heights[0]).toBeCloseTo(2.5, 3);
  });

  it('skips texels under the coverage alpha and does not let translucent sprites hide others', () => {
    const faint = page(2, 2, () => 5, [10, 20, 30, 100]);
    const glass = page(2, 2, () => 5);
    const behind = page(2, 2, () => 0);
    const target = composite(2, 2);
    draw(target, [faint], sprite(1, 0, faint));
    expect([...target.ids!]).toEqual([0, 0, 0, 0]);
    draw(target, [glass], sprite(2, 0, glass), 0.5);
    draw(target, [behind], sprite(3, 0, behind));
    expect([...target.ids!]).toEqual([3, 3, 3, 3]);
  });

  it('blends a translucent sprite over what is already drawn', () => {
    const red = page(1, 1, () => 1, [255, 0, 0, 255]);
    const target = new DepthComposite();
    const colour = new Uint8ClampedArray([0, 0, 255, 255]);
    target.begin(1, 1, colour, false);
    target.ground([]);
    target.sprite(compositeFrame(red, { x: 0, y: 0, width: 1, height: 1 }), sprite(1, 0, red), 0.5);
    expect([...colour]).toEqual([128, 0, 128, 255]);
  });

  it('matches the occlusion oracle pixel for pixel on random scenes with ground', () => {
    let seed = 7;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let scene = 0; scene < 20; scene++) {
      const pages: OraclePage[] = [];
      const sprites: OracleSprite[] = [];
      for (let i = 0; i < 12; i++) {
        const w = 4 + Math.floor(random() * 20);
        const h = 4 + Math.floor(random() * 30);
        const slope = random() * 0.2;
        const p = page(w, h, (x, y) => (h - y) / 16 + x * slope, [
          50 + i * 10,
          80,
          120,
          random() < 0.2 ? 90 : 255,
        ]);
        pages.push(p);
        const zoom = random() < 0.5 ? 1 : 2;
        sprites.push(
          sprite(10 + i, i, p, {
            left: random() * 60 - 10,
            top: random() * 60 - 10,
            width: w * zoom,
            height: h * zoom,
            anchorHeight: random() * 3,
            heightScale: zoom,
          }),
        );
      }
      const ground: OracleTriangle[] = [
        {
          id: 1,
          a: { x: -5, y: 70, height: 0 },
          b: { x: 70, y: 70, height: 0.5 },
          c: { x: 30, y: -5, height: 3 },
        },
      ];
      const truth = compositeScene({ width: 64, height: 64, pages, sprites, triangles: ground });
      const target = composite(64, 64, ground);
      for (const s of sprites) draw(target, pages, s);
      expect([...target.ids!]).toEqual([...truth.ids]);
    }
  });
});
