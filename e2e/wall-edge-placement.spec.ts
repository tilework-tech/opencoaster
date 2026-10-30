import { expect, test } from './support/test';
import type { Page } from './support/test';
import { project } from '../src/render/projection';
import { TILE_UNITS, Z_STEP } from '../src/sim/core/constants';
import { OWNED } from '../src/sim/map/tile-map';
import type { World } from '../src/sim/core/world';
import { createStarterWorld, dragThrough, startStarterPark, toolbarTool } from './footpath-helpers';
import type { Tile } from './footpath-helpers';

type SceneryRecord = { x: number; y: number; edge: number; item: number };

function findOwnedEmptyTile(world: World, near: Tile): Tile {
  for (let radius = 0; radius < 12; radius++)
    for (let y = near.y - radius; y <= near.y + radius; y++)
      for (let x = near.x - radius; x <= near.x + radius; x++) {
        if (Math.max(Math.abs(x - near.x), Math.abs(y - near.y)) !== radius) continue;
        if (x < 2 || y < 2 || x >= world.map.width - 2 || y >= world.map.height - 2) continue;
        const index = world.map.index(x, y);
        if (
          world.map.ownership[index]! & OWNED &&
          world.map.slope[index] === 0 &&
          world.map.firstElement(index) < 0
        )
          return { x, y };
      }
  throw new Error('No empty owned tile found near the park centre');
}

function findOwnedEmptyRun(world: World, near: Tile, length: number): Tile[] {
  for (let radius = 0; radius < 12; radius++)
    for (let y = near.y - radius; y <= near.y + radius; y++)
      for (let x = near.x - radius; x <= near.x + radius; x++) {
        if (Math.max(Math.abs(x - near.x), Math.abs(y - near.y)) !== radius) continue;
        const run = Array.from({ length }, (_, offset) => ({ x: x + offset, y }));
        if (
          run.every(({ x: tx, y: ty }) => {
            if (tx < 2 || ty < 2 || tx >= world.map.width - 2 || ty >= world.map.height - 2)
              return false;
            const index = world.map.index(tx, ty);
            return (
              world.map.ownership[index]! & OWNED &&
              world.map.slope[index] === 0 &&
              world.map.firstElement(index) < 0
            );
          })
        )
          return run;
      }
  throw new Error('No contiguous owned empty run found near the park centre');
}

async function edgeScreenPoint(
  page: Page,
  world: World,
  tile: Tile,
  edge: number,
): Promise<[number, number]> {
  const game = await page.locator('#game').boundingBox();
  if (!game) throw new Error('Game viewport is missing');
  const camera = await page.evaluate(
    () =>
      (
        window as unknown as {
          __camera: { x: number; y: number; zoom: number; rotation: 0 | 1 | 2 | 3 };
        }
      ).__camera,
  );
  const map = world.map;
  const index = map.index(tile.x, tile.y);
  const cornerIndices = [
    [1, 2],
    [2, 3],
    [3, 0],
    [0, 1],
  ][edge]!;
  const corners = [
    [tile.x, tile.y, map.heights[index]! + (map.slope[index]! & 1)],
    [tile.x + 1, tile.y, map.heights[index]! + ((map.slope[index]! >> 1) & 1)],
    [tile.x + 1, tile.y + 1, map.heights[index]! + ((map.slope[index]! >> 2) & 1)],
    [tile.x, tile.y + 1, map.heights[index]! + ((map.slope[index]! >> 3) & 1)],
  ];
  const screen = cornerIndices.map((corner) => {
    const [x, y, z] = corners[corner]!;
    const out = new Float64Array(2);
    project(
      x * TILE_UNITS,
      y * TILE_UNITS,
      z * Z_STEP,
      map.width,
      map.height,
      camera.rotation,
      out,
    );
    return [
      game.x + game.width / 2 + (out[0]! - camera.x) * camera.zoom,
      game.y + game.height / 2 + (out[1]! - camera.y) * camera.zoom,
    ];
  });
  const midpoint: [number, number] = [
    (screen[0]![0]! + screen[1]![0]!) / 2,
    (screen[0]![1]! + screen[1]![1]!) / 2,
  ];
  const centreWorld = new Float64Array(2);
  project(
    (tile.x + 0.5) * TILE_UNITS,
    (tile.y + 0.5) * TILE_UNITS,
    map.heights[index]! * Z_STEP,
    map.width,
    map.height,
    camera.rotation,
    centreWorld,
  );
  const centre: [number, number] = [
    game.x + game.width / 2 + (centreWorld[0]! - camera.x) * camera.zoom,
    game.y + game.height / 2 + (centreWorld[1]! - camera.y) * camera.zoom,
  ];
  return [midpoint[0] * 0.8 + centre[0] * 0.2, midpoint[1] * 0.8 + centre[1] * 0.2];
}

async function scenery(page: Page): Promise<SceneryRecord[]> {
  return page.evaluate(() => {
    const map = (
      window as unknown as { __map: { sceneryCount: number; sceneryElements: Int32Array } }
    ).__map;
    return Array.from({ length: map.sceneryCount }, (_, index) => {
      const offset = index * 5;
      return {
        x: map.sceneryElements[offset]!,
        y: map.sceneryElements[offset + 1]!,
        edge: map.sceneryElements[offset + 3]! & 3,
        item: map.sceneryElements[offset + 4]!,
      };
    }).filter((row) => row.item >= 5 && row.item <= 7);
  });
}

async function chooseWall(page: Page): Promise<void> {
  await toolbarTool(page, 'Scenery');
  await page.getByRole('button', { name: 'Fences and walls', exact: true }).click();
  await page.getByRole('button', { name: 'Wooden fence, $0.60', exact: true }).click();
}

test.describe('wall edge placement', () => {
  test('selects all four tile edges across camera turns and drag-places a continuous run', async ({
    page,
  }) => {
    const world = createStarterWorld();
    const tile = findOwnedEmptyTile(world, { x: 28, y: 42 });
    await startStarterPark(page);
    await chooseWall(page);

    for (let edge = 0; edge < 4; edge++) {
      const [x, y] = await edgeScreenPoint(page, world, tile, edge);
      await page.mouse.move(x, y);
      await expect(page.locator('.placement-label')).toContainText('Wooden fence');
      await page.mouse.click(x, y);
      await expect
        .poll(
          async () =>
            (await scenery(page)).filter((item) => item.x === tile.x && item.y === tile.y).length,
        )
        .toBe(edge + 1);
      await page.keyboard.press('z');
    }
    expect(
      (await scenery(page))
        .filter((item) => item.x === tile.x && item.y === tile.y)
        .map((item) => item.edge)
        .sort(),
    ).toEqual([0, 1, 2, 3]);

    const run = findOwnedEmptyRun(world, { x: tile.x + 4, y: tile.y + 4 }, 4);
    await dragThrough(page, world, run);
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          (await scenery(page)).filter((item) =>
            run.some((point) => point.x === item.x && point.y === item.y),
          ).length,
      )
      .toBe(run.length);
  });

  test('places all four edges and a continuous run with the Canvas2D renderer', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
        if (type === 'webgl2') return null;
        return original.call(this, type as never, ...(args as []));
      };
    });
    const world = createStarterWorld();
    const tile = findOwnedEmptyTile(world, { x: 28, y: 42 });
    await startStarterPark(page);
    await chooseWall(page);
    for (let edge = 0; edge < 4; edge++) {
      const [x, y] = await edgeScreenPoint(page, world, tile, edge);
      await page.mouse.move(x, y);
      await expect(page.locator('.placement-label')).toContainText('Wooden fence');
      await page.mouse.click(x, y);
      await expect
        .poll(
          async () =>
            (await scenery(page)).filter((item) => item.x === tile.x && item.y === tile.y).length,
        )
        .toBe(edge + 1);
      await page.keyboard.press('z');
    }
    expect(
      (await scenery(page))
        .filter((item) => item.x === tile.x && item.y === tile.y)
        .map((item) => item.edge)
        .sort(),
    ).toEqual([0, 1, 2, 3]);

    const run = findOwnedEmptyRun(world, { x: tile.x + 4, y: tile.y + 4 }, 4);
    await dragThrough(page, world, run);
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          (await scenery(page)).filter((item) =>
            run.some((point) => point.x === item.x && point.y === item.y),
          ).length,
      )
      .toBe(run.length);
  });
});
