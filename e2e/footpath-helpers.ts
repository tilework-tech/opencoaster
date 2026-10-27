import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { project } from '../src/render/projection';
import { TILE_UNITS, Z_STEP } from '../src/sim/core/constants';
import { World } from '../src/sim/core/world';
import { parseScenarioFile } from '../src/sim/scenario/scenario-file';
import { planPathPlacement, PathResult } from '../src/sim/map/paths';
import { prepareScenario } from '../src/sim/scenario/scenario-layout';

export interface Tile {
  x: number;
  y: number;
}

/** The Starter Park world as the browser's worker builds it, for reading tile heights and ownership. */
export function createStarterWorld(): World {
  return createScenarioWorld('starter');
}

export function createScenarioWorld(id: 'starter' | 'open-grounds'): World {
  const scenario = parseScenarioFile(
    JSON.parse(
      readFileSync(new URL(`../src/sim/scenario/scenarios/${id}.json`, import.meta.url), 'utf8'),
    ),
  );
  const world = new World({
    seed: scenario.seed,
    width: scenario.mapWidth,
    height: scenario.mapHeight,
  });
  prepareScenario(world, scenario);
  return world;
}

/** Lists the four tiles that can connect a ride entrance to the public path network. */
export function adjacentPathTiles(entrance: Tile): Tile[] {
  return [
    { x: entrance.x - 1, y: entrance.y },
    { x: entrance.x + 1, y: entrance.y },
    { x: entrance.x, y: entrance.y - 1 },
    { x: entrance.x, y: entrance.y + 1 },
  ];
}

/** The HUD cash readout in the bottom-left corner. */
export async function hudCash(page: Page): Promise<string> {
  const readouts = page.getByText(/^\$[\d,]+\.\d\d$/);
  const count = await readouts.count();
  for (let i = 0; i < count; i++) {
    const box = await readouts.nth(i).boundingBox();
    if (box && box.x < 300 && box.y > 600) return readouts.nth(i).innerText();
  }
  throw new Error('HUD cash readout is missing');
}

/** Cash in cents, read from the HUD. */
export async function hudCashCents(page: Page): Promise<number> {
  return Math.round(Number((await hudCash(page)).replace(/[$,]/g, '')) * 100);
}

/** Screen position of a tile's ground centre, in page pixels. */
export async function tileScreenPoint(
  page: Page,
  world: World,
  tile: Tile,
): Promise<[number, number]> {
  const game = await page.locator('#game').boundingBox();
  if (!game) throw new Error('Game viewport is missing');
  const camera = await page.evaluate(() => {
    const { x, y, zoom, rotation } = (
      window as unknown as {
        __camera: { x: number; y: number; zoom: number; rotation: 0 | 1 | 2 | 3 };
      }
    ).__camera;
    return { x, y, zoom, rotation };
  });
  const map = world.map;
  const index = map.index(tile.x, tile.y);
  const projected = new Float64Array(2);
  project(
    (tile.x + 0.5) * TILE_UNITS,
    (tile.y + 0.5) * TILE_UNITS,
    map.heights[index]! * Z_STEP,
    map.width,
    map.height,
    camera.rotation,
    projected,
  );
  return [
    game.x + game.width / 2 + (projected[0]! - camera.x) * camera.zoom,
    game.y + game.height / 2 + (projected[1]! - camera.y) * camera.zoom,
  ];
}

export async function clickGameTile(page: Page, world: World, tile: Tile): Promise<void> {
  const [x, y] = await tileScreenPoint(page, world, tile);
  await page.mouse.click(x, y);
}

export async function hoverGameTile(page: Page, world: World, tile: Tile): Promise<void> {
  const [x, y] = await tileScreenPoint(page, world, tile);
  await page.mouse.move(x, y);
}

export async function startStarterPark(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  await page
    .locator('.scenario-card')
    .filter({ hasText: 'Starter Park' })
    .getByRole('button', { name: 'Start', exact: true })
    .click();
  await expect(page.locator('.game-toolbar')).toBeVisible();
  // The opening camera is applied when the map arrives, which can land after the toolbar shows.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __camera: { x: number } }).__camera.x))
    .not.toBe(0);
}

/** Presses a toolbar button, opening the Actions overflow first on narrow screens that hide it. */
export async function toolbarTool(page: Page, name: string): Promise<void> {
  const toolbar = page.locator('.game-toolbar');
  const action = toolbar.getByRole('button', { name, exact: true });
  if (!(await action.isVisible())) {
    const actions = toolbar.getByRole('button', { name: 'Actions', exact: true });
    if ((await actions.getAttribute('aria-expanded')) !== 'true') await actions.click();
    await expect(action).toBeVisible();
  }
  await action.click();
}

/** Presses on the first tile, drags through each following tile centre, and holds there. */
export async function dragThrough(page: Page, world: World, tiles: Tile[]): Promise<void> {
  const [startX, startY] = await tileScreenPoint(page, world, tiles[0]!);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (const tile of tiles.slice(1)) {
    const [x, y] = await tileScreenPoint(page, world, tile);
    await page.mouse.move(x, y, { steps: 6 });
  }
}

/**
 * The first straight run of `length` tiles along +x, searching outward from `near`, that the
 * world would accept a footpath on. Tiles the player does not own are never chosen.
 */
export function findBuildableRun(world: World, length: number, near: Tile): Tile[] {
  // Flat pieces on one level join each other, so the run's connections are predictable.
  const level = (tile: Tile): number => world.map.heights[world.map.index(tile.x, tile.y)]!;
  const accepts = (tile: Tile): boolean => {
    const plan = planPathPlacement(world.map, { x: tile.x, y: tile.y });
    return plan.result === PathResult.Ok && plan.dir === -1;
  };
  for (let radius = 0; radius <= 10; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const run = Array.from({ length }, (_, k) => ({ x: near.x + dx + k, y: near.y + dy }));
        if (run.every(accepts) && run.every((tile) => level(tile) === level(run[0]!))) return run;
      }
    }
  }
  throw new Error(`No buildable run of ${length} tiles near ${near.x}, ${near.y}`);
}

/** Centres the view on a tile's ground at the given zoom, for the camera's current rotation. */
export async function centerCameraOn(
  page: Page,
  world: World,
  tile: Tile,
  zoom: number,
): Promise<void> {
  const map = world.map;
  const rotation = await page.evaluate(
    () => (window as unknown as { __camera: { rotation: number } }).__camera.rotation,
  );
  const projected = new Float64Array(2);
  project(
    (tile.x + 0.5) * TILE_UNITS,
    (tile.y + 0.5) * TILE_UNITS,
    map.heights[map.index(tile.x, tile.y)]! * Z_STEP,
    map.width,
    map.height,
    rotation as 0 | 1 | 2 | 3,
    projected,
  );
  await page.evaluate(
    ([x, y, z]) => {
      const camera = (window as unknown as { __camera: { x: number; y: number; zoom: number } })
        .__camera;
      camera.x = x!;
      camera.y = y!;
      camera.zoom = z!;
    },
    [projected[0]!, projected[1]!, zoom],
  );
}
