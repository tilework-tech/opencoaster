import { describe, expect, it } from 'vitest';
import { PALETTE, ramp } from './palette';
import { box, material, quad, rotateMesh } from './mesh';
import { project, renderMesh, TRANSPARENT } from './raster';

const asphalt = material(ramp('asphalt'));

function opaqueCount(pixels: Uint8Array): number {
  return pixels.reduce((n, p) => n + (p === TRANSPARENT ? 0 : 1), 0);
}

describe('dimetric projection', () => {
  it('maps tile steps onto the 64x32 diamond and height levels onto 16px', () => {
    const origin = project(0, 0, 0);
    expect(project(1, 0, 0)).toEqual([origin[0] + 32, origin[1] + 16]);
    expect(project(0, 1, 0)).toEqual([origin[0] - 32, origin[1] + 16]);
    expect(project(0, 0, 1)).toEqual([origin[0], origin[1] - 16]);
  });
});

describe('renderMesh', () => {
  const tile = [
    ...quad(
      [
        [-0.5, -0.5, 0],
        [0.5, -0.5, 0],
        [0.5, 0.5, 0],
        [-0.5, 0.5, 0],
      ],
      asphalt,
    ),
  ];

  it('rasterises a flat tile as the classic 64x32 diamond with 2px-stepped rows', () => {
    const sprite = renderMesh(tile, { outline: false });
    expect(sprite.width).toBe(64);
    expect(sprite.height).toBe(32);
    expect(opaqueCount(sprite.pixels)).toBe(1024);
    const rowWidth = (y: number): number =>
      sprite.pixels.slice(y * 64, y * 64 + 64).filter((p) => p !== TRANSPARENT).length;
    expect(rowWidth(0)).toBe(2);
    expect(rowWidth(15)).toBe(62);
    expect(rowWidth(16)).toBe(62);
    expect(rowWidth(31)).toBe(2);
    expect(sprite.anchor).toEqual({ x: 32, y: 16 });
  });

  it('is deterministic', () => {
    const a = renderMesh(box([-0.3, -0.3, 0], [0.3, 0.3, 0.5], asphalt));
    const b = renderMesh(box([-0.3, -0.3, 0], [0.3, 0.3, 0.5], asphalt));
    expect(Buffer.from(a.pixels).equals(Buffer.from(b.pixels))).toBe(true);
  });

  it('lights the top brightest, then the +y face, then the +x face', () => {
    const sprite = renderMesh(box([-0.4, -0.4, 0], [0.4, 0.4, 1], asphalt), { outline: false });
    const at = (sx: number, sy: number): number =>
      sprite.pixels[(sprite.anchor.y + sy) * sprite.width + sprite.anchor.x + sx];
    const top = at(0, -16);
    const left = at(-10, 4);
    const right = at(10, 4);
    expect(asphalt.ramp.indexOf(top)).toBeGreaterThan(asphalt.ramp.indexOf(left));
    expect(asphalt.ramp.indexOf(left)).toBeGreaterThan(asphalt.ramp.indexOf(right));
  });

  it('only uses palette colours and no half-transparent pixels', () => {
    const sprite = renderMesh(box([-0.3, -0.3, 0], [0.3, 0.3, 0.5], asphalt));
    for (const p of sprite.pixels) expect(p === TRANSPARENT || p < PALETTE.length).toBe(true);
  });

  it('adds a one pixel outline around the silhouette', () => {
    const plain = renderMesh(tile, { outline: false });
    const outlined = renderMesh(tile, { outline: true });
    expect(outlined.width).toBe(plain.width + 2);
    expect(outlined.height).toBe(plain.height + 2);
    expect(opaqueCount(outlined.pixels)).toBeGreaterThan(opaqueCount(plain.pixels));
  });

  it('rotates models a quarter turn per view', () => {
    const post = box([0.2, -0.1, 0], [0.4, 0.1, 1], asphalt);
    const base = renderMesh(post, { outline: false });
    const turned = renderMesh(rotateMesh(post, 1), { outline: false });
    expect(Buffer.from(turned.pixels).equals(Buffer.from(base.pixels))).toBe(false);
    const full = renderMesh(rotateMesh(post, 4), { outline: false });
    expect(Buffer.from(full.pixels).equals(Buffer.from(base.pixels))).toBe(true);
  });

  it('keeps anchors centred horizontally with even dimensions', () => {
    const sprite = renderMesh(box([0.2, -0.1, 0], [0.4, 0.1, 1], asphalt));
    expect(sprite.width % 2).toBe(0);
    expect(sprite.height % 2).toBe(0);
    expect(sprite.anchor.x).toBe(sprite.width / 2);
  });
});

describe('renderMesh height map', () => {
  const stone = material(ramp('asphalt'));

  function heightAt(sprite: ReturnType<typeof renderMesh>, sx: number, sy: number): number {
    return sprite.heights![(sy + sprite.anchor.y) * sprite.width + sx + sprite.anchor.x];
  }

  it('records the height in levels of the visible surface at every opaque pixel', () => {
    const sprite = renderMesh(box([-0.25, -0.25, 0], [0.25, 0.25, 2], stone), { outline: false });
    // Screen point of the top face centre: (0, 0, 2) projects 32px above the origin.
    expect(heightAt(sprite, 0, -32)).toBeCloseTo(2, 1);
    // A point on the front-right wall at height 1: (0.25, 0, 1).
    const [wx, wy] = project(0.25, 0, 1);
    expect(heightAt(sprite, Math.floor(wx) - 1, Math.floor(wy))).toBeCloseTo(1, 0);
  });

  it('keeps the nearer surface where two parts of the mesh overlap on screen', () => {
    const back = box([-0.5, -0.5, 0], [-0.3, -0.3, 3], stone);
    const front = box([0.3, 0.3, 0], [0.5, 0.5, 0.5], stone);
    const sprite = renderMesh([...back, ...front], { outline: false });
    // The front block's top centre (0.4, 0.4, 0.5) lies on the same screen ray as a point of the
    // tall back column at height 2.1; the front block is nearer, so its height wins.
    const [sx, sy] = project(0.4, 0.4, 0.5);
    expect(heightAt(sprite, Math.floor(sx), Math.floor(sy))).toBeCloseTo(0.5, 1);
  });

  it('marks transparent pixels as having no height and gives outline pixels a neighbour height', () => {
    const sprite = renderMesh(box([-0.25, -0.25, 0], [0.25, 0.25, 1], stone));
    for (let i = 0; i < sprite.pixels.length; i++) {
      if (sprite.pixels[i] === TRANSPARENT) expect(Number.isNaN(sprite.heights![i])).toBe(true);
      else expect(Number.isFinite(sprite.heights![i])).toBe(true);
    }
  });
});
