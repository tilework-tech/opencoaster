import { describe, expect, it } from 'vitest';
import { TILE_UNITS } from '../sim/core/constants';
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
