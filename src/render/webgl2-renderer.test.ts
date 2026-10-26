import { describe, expect, it } from 'vitest';
import { TILE_UNITS } from '../sim/core/constants';
import { PathFlag } from '../sim/map/tile-map';
import { WebGL2Renderer, rotatedPositionSum } from './webgl2-renderer';
import type { MapData, SpriteGhost } from './renderer';

const map: MapData = {
  width: 5,
  height: 5,
  heights: new Uint8Array(25),
  surface: new Uint8Array(25),
  slope: new Uint8Array(25),
};

describe('WebGL2 sprite preview ordering', () => {
  it('sorts previews from the rendered pivot, including the tile-centre offset', () => {
    const renderer = new WebGL2Renderer();
    const ghost: SpriteGhost = {
      x: 2,
      y: 2,
      level: 2,
      sprite: 'trees/tree-oak',
      kind: 'scenery',
      width: 36,
      height: 36,
      tone: 'ok',
    };
    renderer.setSpriteGhosts([ghost]);
    const appended: unknown[][] = [];
    const testRenderer = renderer as unknown as {
      appendSpriteGhosts(
        map: MapData,
        camera: { x: number; y: number; zoom: number; rotation: 0 },
        viewportWidth: number,
        viewportHeight: number,
      ): void;
      append: (...args: unknown[]) => void;
    };
    testRenderer.append = (...args) => appended.push(args);

    testRenderer.appendSpriteGhosts(map, { x: 0, y: 0, zoom: 1, rotation: 0 }, 800, 600);

    const pivotX = ghost.x * TILE_UNITS + TILE_UNITS / 2;
    const pivotY = ghost.y * TILE_UNITS + TILE_UNITS / 2;
    expect(appended).toHaveLength(1);
    expect(appended[0]![6]).toBe(2 * rotatedPositionSum(pivotX, pivotY, map, 0) - ghost.level + 2);
  });
});

const SHAPES = [
  ['straight', 0b0101, 2],
  ['corner', 0b0011, 2],
  ['T-junction', 0b0111, 1],
  ['crossroads', 0b1111, 0],
  ['dead-end', 0b0001, 3],
] as const;

function appendedPathAdditions(flags: number, rotation: 0 | 1 | 2 | 3) {
  const renderer = new WebGL2Renderer();
  const pathMap: MapData = {
    ...map,
    pathElements: Int32Array.of(2, 2, 2, flags, 0, 0),
    pathCount: 1,
  };
  const appended: unknown[][] = [];
  const testRenderer = renderer as unknown as {
    appendPathElements(map: MapData, camera: object, w: number, h: number): void;
    append: (...args: unknown[]) => void;
  };
  testRenderer.append = (...args) => appended.push(args);
  testRenderer.appendPathElements(pathMap, { x: 0, y: 0, zoom: 1, rotation }, 800, 600);
  return appended.filter((args) => String(args[5]).startsWith('scenery/'));
}

describe('WebGL2 path additions on open edges', () => {
  it.each(SHAPES)('draws %s benches on every open edge in all rotations', (_s, edges, count) => {
    for (const rotation of [0, 1, 2, 3] as const) {
      const items = appendedPathAdditions(PathFlag.Bench | edges, rotation);
      expect(items).toHaveLength(count);
      const positions = new Set(items.map((args) => `${args[0]},${args[1]}`));
      expect(positions.size).toBe(count);
      for (const args of items) {
        expect(Math.abs((args[0] as number) - (2 * TILE_UNITS + 128))).toBeLessThan(128);
        expect(Math.abs((args[1] as number) - (2 * TILE_UNITS + 128))).toBeLessThan(128);
      }
    }
  });

  it('stands lamps on four corner posts of a crossroads', () => {
    for (const rotation of [0, 1, 2, 3] as const)
      expect(appendedPathAdditions(PathFlag.Lamp | 0b1111, rotation)).toHaveLength(4);
  });

  it('draws the same open edges on sloped paths at the slope surface height', () => {
    for (const rotation of [0, 1, 2, 3] as const) {
      const items = appendedPathAdditions(PathFlag.Bench | PathFlag.Sloped | 0b0101, rotation);
      expect(items).toHaveLength(2);
      for (const args of items) expect(args[2]).toBe(2 * 64 + 32 + 1);
    }
  });

  it('sorts each copy from its own position so nearer copies draw later', () => {
    const items = appendedPathAdditions(PathFlag.Bench | 0b0001, 0);
    const byDepth = [...items].sort((a, b) => (a[6] as number) - (b[6] as number));
    const bySum = [...items].sort(
      (a, b) => (a[0] as number) + (a[1] as number) - ((b[0] as number) + (b[1] as number)),
    );
    expect(byDepth.map((a) => a[5])).toEqual(bySum.map((a) => a[5]));
  });
});
