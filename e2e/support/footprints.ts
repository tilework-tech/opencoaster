import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { RIDE_CATALOG } from '../../src/sim/rides/ride-types';
import type { RideType } from '../../src/sim/rides/ride-types';
import { World } from '../../src/sim/core/world';
import { parseScenarioFile } from '../../src/sim/scenario/scenario-file';
import { prepareScenario } from '../../src/sim/scenario/scenario-layout';
import { serialize } from '../../src/save/save';
import { rideFootprintTiles } from '../../src/sim/rides/ride-footprint';

export type Tile = readonly [x: number, y: number];

/** Starter Park tile the minimap click centres the camera on for the build helpers. */
export const MAP_CENTER: Tile = [28, 43];

/** On-screen size of one tile at the default zoom, in CSS pixels. */
const TILE_HALF_WIDTH = 32;
const TILE_HALF_HEIGHT = 16;

/**
 * Starter Park footpath network every ride-building spec shares: a spur along y = 43 and a
 * branch north along x = 28. A flat ride built west of the branch and north of the spur touches
 * both without covering either.
 */
export const STARTER_PATH_TILES: readonly Tile[] = [
  [26, 43],
  [27, 43],
  [28, 43],
  [28, 42],
  [28, 41],
  [28, 40],
];

/**
 * Anchor for a 3x3 flat ride (Merry-Go-Round) that fits between the spur and the branch of
 * {@link STARTER_PATH_TILES}: it covers x 25-27, y 40-42, so the branch runs along its east side
 * and the spur along its south side.
 */
export const FLAT_RIDE_ANCHOR: Tile = [26, 41];

/** Path tile beside the ride footprint at {@link FLAT_RIDE_ANCHOR} used for the entrance. */
export const FLAT_RIDE_ENTRANCE: Tile = [28, 41];

/** Path tile beside the ride footprint at {@link FLAT_RIDE_ANCHOR} used for the exit. */
export const FLAT_RIDE_EXIT: Tile = [26, 43];

/**
 * Anchor for a second 3x3 ride that shares an edge with the one at {@link FLAT_RIDE_ANCHOR}
 * (it covers x 25-27, y 37-39, directly north of it).
 */
export const ABUTTING_RIDE_ANCHOR: Tile = [26, 38];

/** Open tile on the spur that a food stall can face while clear of the flat ride. */
export const STALL_TILE: Tile = [25, 43];

const CORE_ACTIONS = [
  'Pause',
  'Footpaths',
  'New ride',
  'Rides',
  'Finances',
  'Staff',
  'Park',
  'Save / Load',
];

/** Tiles a ride of `type` covers when anchored at `anchor` and turned `dir` quarter turns. */
export function footprintTiles(type: number, anchor: Tile, dir = 0): Tile[] {
  const def = RIDE_CATALOG[type as RideType];
  return rideFootprintTiles(def, anchor[0], anchor[1], dir);
}

/** Tiles edge-adjacent to the footprint but outside it: the entrance/exit candidates. */
export function footprintRing(type: number, anchor: Tile, dir = 0): Tile[] {
  const own = new Set(footprintTiles(type, anchor, dir).map(([x, y]) => `${x},${y}`));
  const ring = new Map<string, Tile>();
  for (const [x, y] of footprintTiles(type, anchor, dir))
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ] as const) {
      const key = `${x + dx},${y + dy}`;
      if (!own.has(key)) ring.set(key, [x + dx, y + dy]);
    }
  return [...ring.values()];
}

export async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage: true, timeout: 30_000 });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

const starterScenario = parseScenarioFile(
  JSON.parse(
    readFileSync(new URL('../../src/sim/scenario/scenarios/starter.json', import.meta.url), 'utf8'),
  ),
);

/** Imports a fresh Starter Park save in which the given ride types are already researched. */
export async function unlockRides(
  page: Page,
  testInfo: TestInfo,
  types: readonly number[],
  mobile = false,
): Promise<void> {
  const world = new World({
    seed: starterScenario.seed,
    width: starterScenario.mapWidth,
    height: starterScenario.mapHeight,
  });
  prepareScenario(world, starterScenario);
  for (const type of types) world.research.unlocked.add(type);
  const savePath = testInfo.outputPath('starter-unlocked.park');
  await mkdir(dirname(savePath), { recursive: true });
  await writeFile(savePath, serialize(world));
  await toolbarAction(page, 'Save / Load', mobile);
  await page.getByRole('button', { name: 'Import save file' }).click();
  await page.locator('.save-menu input[type="file"]').setInputFiles(savePath);
  await expect(page.locator('.save-menu .save-message')).toHaveText('Imported save file.', {
    timeout: 30_000,
  });
  await expect(page.locator('.hud')).toContainText('tick', { timeout: 30_000 });
}

export async function startStarterPark(page: Page, mobile = false): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  await page
    .locator('.scenario-card')
    .filter({ hasText: 'Starter Park' })
    .getByRole('button', { name: 'Start', exact: true })
    .click();
  await expect(page.locator('.hud')).toContainText('tick', { timeout: 30_000 });
  if (mobile) {
    const toolbar = page.locator('.game-toolbar');
    await toolbar.getByRole('button', { name: 'Actions', exact: true }).tap();
    for (const label of CORE_ACTIONS) {
      const action = toolbar.getByRole('button', { name: label, exact: true });
      await expect(action).toBeVisible();
      const size = await action.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return [rect.width, rect.height];
      });
      expect(size[0], `${label} width`).toBeGreaterThanOrEqual(44);
      expect(size[1], `${label} height`).toBeGreaterThanOrEqual(44);
    }
    await toolbar.getByRole('button', { name: 'Actions', exact: true }).tap();
  }
}

export async function toolbarAction(page: Page, name: string, mobile = false): Promise<void> {
  const toolbar = page.locator('.game-toolbar');
  if (mobile) {
    await toolbar.getByRole('button', { name: 'Actions', exact: true }).tap();
    await toolbar.getByRole('button', { name, exact: true }).tap();
  } else await toolbar.getByRole('button', { name, exact: true }).click();
}

/** Centres the camera on a tile through the minimap. */
export async function centerMapOnTile(page: Page, [x, y]: Tile, mobile = false): Promise<void> {
  await toolbarAction(page, 'Map', mobile);
  const minimap = page.locator('.minimap');
  await page.waitForFunction(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.minimap');
    const map = (window as unknown as { __map?: { width: number; height: number } }).__map;
    return (
      !!canvas &&
      !!map &&
      canvas.width === map.width + map.height &&
      canvas.height === Math.ceil((map.width + map.height) / 2) + 1
    );
  });
  const bounds = await minimap.boundingBox();
  if (!bounds) throw new Error('Park map is missing');
  const size = await minimap.evaluate((canvas) => ({ width: canvas.width, height: canvas.height }));
  const mapHeight = size.height - 1;
  await minimap.click({
    position: {
      x: ((x - y + mapHeight + 0.5) / size.width) * bounds.width,
      y: (((x + y) / 2 + 0.25) / size.height) * bounds.height,
    },
  });
  await page.getByRole('button', { name: 'Close Map' }).click();
}

/** Screen position of a tile, in page CSS pixels, with the camera on {@link MAP_CENTER}. */
export async function tileScreenPoint(page: Page, [x, y]: Tile): Promise<{ x: number; y: number }> {
  const bounds = await page.locator('#game').boundingBox();
  if (!bounds) throw new Error('Game viewport is missing');
  // The click point is offset one tile along x and two tile-rows up so it lands on the tile's
  // top face rather than the neighbour the projection of its corner falls on.
  const dx = x - 1 - MAP_CENTER[0];
  const dy = y - MAP_CENTER[1];
  return {
    x: bounds.x + bounds.width / 2 + (dx - dy) * TILE_HALF_WIDTH,
    y: bounds.y + bounds.height / 2 + (dx + dy) * TILE_HALF_HEIGHT - 4 * TILE_HALF_HEIGHT,
  };
}

/**
 * Clicks a tile and checks the tool status names the tile that was hit. Re-centres the camera on
 * {@link MAP_CENTER} first unless `recenter` is false.
 */
export async function clickTile(
  page: Page,
  tile: Tile,
  mobile = false,
  recenter = true,
): Promise<void> {
  if (recenter) await centerMapOnTile(page, MAP_CENTER, mobile);
  const point = await tileScreenPoint(page, tile);
  await page.mouse.click(point.x, point.y);
  // Footpath laying answers after the sim previews it, so wait for the status to name this tile.
  await expect
    .poll(() => page.locator('.tool-status').innerText(), { timeout: 10_000 })
    .toMatch(new RegExp(`(?:requested at| at) ${tile[0]}, ${tile[1]}\\b`));
}

/** Paints footpaths on the given tiles with the Footpaths tool. */
export async function paintPaths(
  page: Page,
  tiles: readonly Tile[],
  mobile = false,
): Promise<void> {
  const toolbar = page.locator('.game-toolbar');
  if (mobile) await toolbar.getByRole('button', { name: 'Actions', exact: true }).tap();
  const resume = toolbar.getByRole('button', { name: 'Resume', exact: true });
  const wasPaused = (await resume.count()) > 0;
  if (mobile) await toolbar.getByRole('button', { name: 'Actions', exact: true }).tap();
  if (wasPaused) await toolbarAction(page, 'Resume', mobile);
  await toolbarAction(page, 'Footpaths', mobile);
  await centerMapOnTile(page, MAP_CENTER, mobile);
  for (const tile of tiles) await clickTile(page, tile, mobile, false);
  const closeFootpaths = page.getByRole('button', { name: 'Close Footpaths' });
  if (await closeFootpaths.count()) await closeFootpaths.click();
  if (wasPaused) await toolbarAction(page, 'Pause', mobile);
}

/** Picks a ride card from the New attraction window (its tab and `data-ride-type`). */
export async function chooseRide(
  page: Page,
  tab: string,
  type: number,
  mobile = false,
): Promise<void> {
  await toolbarAction(page, 'New ride', mobile);
  await page.getByRole('tab', { name: tab }).click();
  await page.locator(`.ride-card[data-ride-type="${type}"]`).click();
}

/**
 * Clicks the entrance or exit candidate button the ride-setup ring offers. Pass the tile to
 * pick a specific candidate; otherwise the first offered one is used.
 */
export async function placeBoardingPart(
  page: Page,
  part: 'entrance' | 'exit',
  expectedStatus: string,
  mobile = false,
  at?: Tile,
): Promise<void> {
  await centerMapOnTile(page, MAP_CENTER, mobile);
  const exact = at
    ? page.getByRole('button', { name: `Place ${part} at tile ${at[0]}, ${at[1]}` })
    : null;
  const target =
    exact && (await exact.count()) > 0
      ? exact
      : page.getByRole('button', { name: new RegExp(`Place ${part} at tile`) }).first();
  await target.click();
  await expect(page.locator('.tool-status')).toContainText(expectedStatus);
}
