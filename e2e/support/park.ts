import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { devices, expect as baseExpect } from '@playwright/test';
import type { Browser, Locator, Page } from '@playwright/test';
import { createTestContext } from './test-contexts';
import { World } from '../../src/sim/core/world';
import { deserialize } from '../../src/save/save';
import { parseScenarioFile } from '../../src/sim/scenario/scenario-file';
import { prepareScenario } from '../../src/sim/scenario/scenario-layout';

/** Software-rendered WebGL on a shared runner draws a few frames per second; give overlays time. */
export const expect = baseExpect.configure({ timeout: 20_000 });

export const starterScenario = parseScenarioFile(
  JSON.parse(
    readFileSync(new URL('../../src/sim/scenario/scenarios/starter.json', import.meta.url), 'utf8'),
  ),
);

export interface Calibration {
  /** Tile `centre` belongs to. */
  ref: { x: number; y: number };
  /** Screen centre of the flat reference tile and the diamond's width in CSS pixels. */
  centre: { x: number; y: number };
  tileWidth: number;
}

/** The phone canvas is full-screen behind the tool sheets, so the camera is centred below the target. */
export const PHONE_SHIFT = 5;

export function starterWorld(): World {
  const world = new World({
    seed: starterScenario.seed,
    width: starterScenario.mapWidth,
    height: starterScenario.mapHeight,
  });
  prepareScenario(world, starterScenario);
  return world;
}

export async function openPage(browser: Browser, mobile: boolean): Promise<Page> {
  const { defaultBrowserType: _type, ...options } = mobile ? devices['Pixel 8'] : {};
  void _type;
  const context = await createTestContext(browser, { ...options, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  return page;
}

export async function forceCanvas2D(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
      return originalGetContext.call(this, type as '2d', ...(args as []));
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
}

export async function startScenario(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  await page
    .locator('.scenario-card')
    .filter({ hasText: name })
    .getByRole('button', { name: 'Start', exact: true })
    .click();
  await expect(page.locator('.game-toolbar')).toBeVisible();
  await expect(page.locator('.hud')).toContainText('tick');
}

export async function startStarterPark(page: Page): Promise<void> {
  await startScenario(page, 'Starter Park');
}

export async function toolbarAction(page: Page, name: string): Promise<void> {
  const toolbar = page.locator('.game-toolbar');
  const action = toolbar.getByRole('button', { name, exact: true });
  if (!(await action.isVisible())) {
    const actions = toolbar.getByRole('button', { name: 'Actions', exact: true });
    if ((await actions.getAttribute('aria-expanded')) !== 'true') await actions.click();
    await expect(action).toBeVisible();
  }
  await action.click();
}

export async function centreOnTile(page: Page, x: number, y: number): Promise<void> {
  await toolbarAction(page, 'Map');
  const minimap = page.locator('.minimap');
  await expect.poll(() => minimap.evaluate((canvas) => canvas.width)).toBe(128);
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

/** Centre and width of an overlay tile polygon, and the tile it is drawn for. */
export async function readDiamond(
  polygon: Locator,
): Promise<{ tile: number; centre: { x: number; y: number }; width: number }> {
  return polygon.evaluate((node) => {
    const points = (node.getAttribute('points') ?? '')
      .split(' ')
      .map((pair) => pair.split(',').map(Number));
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    return {
      tile: Number((node as SVGElement).dataset.tile),
      centre: {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
      },
      width: Math.max(...xs) - Math.min(...xs),
    };
  });
}

/**
 * Hovers the middle of the view until `cursor` (the overlay polygon of the tile under the
 * pointer) appears, then derives where `ref` sits on screen from that polygon.
 */
export async function calibrate(
  page: Page,
  ref: { x: number; y: number },
  mobile: boolean,
  cursor: Locator,
  world: World = starterWorld(),
): Promise<Calibration> {
  const game = await page.locator('#game').boundingBox();
  if (!game) throw new Error('Game viewport is missing');
  // The camera was centred PHONE_SHIFT tiles beyond the target diagonally, i.e. 16 px per tile up.
  const lift = mobile ? PHONE_SHIFT * 2 * 16 : 0;
  await expect(async () => {
    await page.mouse.move(game.x + game.width / 2, game.y + game.height / 2 - lift);
    await expect(cursor).toHaveCount(1, { timeout: 1500 });
  }).toPass({ timeout: 30_000, intervals: [1_000] });
  const first = await readDiamond(cursor);
  const tile = { x: first.tile % world.map.width, y: Math.floor(first.tile / world.map.width) };
  const half = first.width / 2;
  const dx = ref.x - tile.x;
  const dy = ref.y - tile.y;
  const levels = world.map.heights[world.map.index(ref.x, ref.y)] - world.map.heights[first.tile];
  return {
    ref,
    centre: {
      x: first.centre.x + (dx - dy) * half,
      y: first.centre.y + (dx + dy) * (half / 2) - levels * 16 * (first.width / 64),
    },
    tileWidth: first.width,
  };
}

export function point(
  cal: Calibration,
  x: number,
  y: number,
  fx = 0.5,
  fy = 0.5,
): [number, number] {
  const half = cal.tileWidth / 2;
  const dx = x - cal.ref.x + (fx - 0.5);
  const dy = y - cal.ref.y + (fy - 0.5);
  return [cal.centre.x + (dx - dy) * half, cal.centre.y + (dx + dy) * (half / 2)];
}

/**
 * Moves the pointer over `target` and waits for the preview to satisfy `check`, nudging the
 * pointer on every retry so a slow software-rendered frame cannot leave the preview stale.
 */
export async function hoverUntil(
  page: Page,
  target: [number, number],
  check: () => Promise<void>,
): Promise<void> {
  let attempt = 0;
  await expect(async () => {
    await page.mouse.move(target[0] + (attempt++ % 2) * 0.3, target[1]);
    await check();
  }).toPass({ timeout: 40_000, intervals: [1_000] });
}

export async function hudCash(page: Page): Promise<number> {
  const readouts = page.getByText(/^\$[\d,]+\.\d\d$/);
  const count = await readouts.count();
  for (let i = 0; i < count; i++) {
    const box = await readouts.nth(i).boundingBox();
    if (box && box.x < 300 && box.y > 400) {
      const text = await readouts.nth(i).innerText();
      return Math.round(Number(text.replace(/[$,]/g, '')) * 100);
    }
  }
  throw new Error('HUD cash readout is missing');
}

export async function hudTick(page: Page): Promise<number> {
  const hud = await page.locator('.hud').innerText();
  const tick = hud.match(/\btick (\d+)\b/);
  if (!tick) throw new Error('Simulation tick is missing from the HUD');
  return Number(tick[1]);
}

export async function waitForSimulationTicks(
  page: Page,
  afterTick: number,
  tickCount: number,
): Promise<void> {
  await page.waitForFunction(
    ({ after, count }) => {
      const tick = (window as unknown as { __sim?: { latest?: { tick?: number } } }).__sim?.latest
        ?.tick;
      return typeof tick === 'number' && tick >= after + count;
    },
    { after: afterTick, count: tickCount },
    { timeout: 30_000 },
  );
}

export async function savedWorld(page: Page): Promise<World> {
  const closeButtons = page.locator('.ui-window button[aria-label^="Close"]');
  while (await closeButtons.count()) await closeButtons.first().click();
  await toolbarAction(page, 'Game options');
  await page.getByRole('button', { name: 'Save, load and quit…' }).click();
  const exportPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export save file' }).click();
  const download = await exportPromise;
  const path = await download.path();
  if (!path) throw new Error('Save export did not produce a file');
  const world = deserialize(new Uint8Array(await readFile(path)));
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Close Options' }).click();
  return world;
}

/** Replaces the running park with a world through the in-game Import save file control. */
export async function importWorld(page: Page, bytes: Uint8Array): Promise<void> {
  await toolbarAction(page, 'Game options');
  await page.getByRole('button', { name: 'Save, load and quit…' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import save file' }).click();
  await (
    await chooser
  ).setFiles({
    name: 'water.ocsave',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(bytes),
  });
  await expect(page.getByText('Imported save file.')).toBeAttached();
  await page.waitForTimeout(1500);
  const closeButtons = page.locator('.ui-window button[aria-label^="Close"]');
  while (await closeButtons.count()) await closeButtons.first().click();
}
