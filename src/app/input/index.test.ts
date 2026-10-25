import { describe, expect, it } from 'vitest';
import { TILE_H, TILE_W, Z_PIXELS } from '../../render/projection';
import { TileMap } from '../../sim/map/tile-map';
import { centreOnTile } from './index';
import type { Camera } from '../../render/renderer';
import type { SimClient } from '../../worker/sim-client';

describe('centreOnTile', () => {
  it('centres the camera on the tile surface, including its terrain elevation', () => {
    const tileMap = new TileMap(8, 8);
    tileMap.heights[tileMap.index(3, 4)] = 6;
    const sim = { map: tileMap } as unknown as SimClient;
    const camera = { x: 0, y: 0, zoom: 1, rotation: 0 } as Camera;

    centreOnTile(3, 4, sim, camera);

    expect(camera.x).toBe((3 - 4) * (TILE_W / 2));
    expect(camera.y).toBe((3 + 4) * (TILE_H / 2) + TILE_H / 2 - 6 * Z_PIXELS);
  });
});
