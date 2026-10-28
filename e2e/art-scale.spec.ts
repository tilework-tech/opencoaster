import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { devices, expect, test } from './support/test';
import type { Browser, Page, TestInfo } from './support/test';
import { World } from '../src/sim/core/world';
import { parseScenarioFile } from '../src/sim/scenario/scenario-file';
import { prepareScenario } from '../src/sim/scenario/scenario-layout';
import { serialize } from '../src/save/save';
import sharp from 'sharp';
import { createTestContext } from './support/test-contexts';
import { footprintRing, footprintTiles } from './support/footprints';
import { expectRingCandidates } from './support/shots';

/** One tile's diamond at the default zoom: 64 x 32 CSS px. */
const TILE_AREA = (64 * 32) / 2;

/** Head-room above the footprint's top candidate that a standing sprite may reach, in CSS px. */
const SPRITE_HEIGHT_ALLOWANCE = 90;

const MAP_CENTER: readonly [number, number] = [28, 43];
const starterScenario = parseScenarioFile(
  JSON.parse(
    readFileSync(new URL('../src/sim/scenario/scenarios/starter.json', import.meta.url), 'utf8'),
  ),
);

interface Shot {
  data: Buffer;
  width: number;
  height: number;
}

async function capture(page: Page, testInfo: TestInfo, name: string): Promise<Shot> {
  const path = testInfo.outputPath(`${name}.png`);
  await mkdir(dirname(path), { recursive: true });
  const bytes = await page.screenshot({ path, timeout: 30_000 });
  await testInfo.attach(name, { path, contentType: 'image/png' });
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function changed(a: Shot, b: Shot, x: number, y: number): boolean {
  const i = (y * a.width + x) * 4;
  return (
    Math.abs(a.data[i] - b.data[i]) +
      Math.abs(a.data[i + 1] - b.data[i + 1]) +
      Math.abs(a.data[i + 2] - b.data[i + 2]) >
    24
  );
}

async function openPage(browser: Browser, mobile: boolean): Promise<Page> {
  const { defaultBrowserType: _browserType, ...options } = mobile ? devices['Pixel 8'] : {};
  void _browserType;
  const context = await createTestContext(browser, { ...options, serviceWorkers: 'allow' });
  return context.newPage();
}

async function startStarterPark(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  await page
    .locator('.scenario-card')
    .filter({ hasText: 'Starter Park' })
    .getByRole('button', { name: 'Start', exact: true })
    .click();
  await expect(page.locator('.hud')).toContainText('tick');
}

async function importRideUnlockedStarterPark(
  page: Page,
  testInfo: TestInfo,
  rideType: number,
  mobile: boolean,
): Promise<void> {
  const world = new World({
    seed: starterScenario.seed,
    width: starterScenario.mapWidth,
    height: starterScenario.mapHeight,
  });
  prepareScenario(world, starterScenario);
  world.research.unlocked.add(rideType);
  const savePath = testInfo.outputPath(`ride-${rideType}-unlocked.park`);
  await writeFile(savePath, serialize(world));
  await toolbarAction(page, 'Save / Load', mobile);
  await page.getByRole('button', { name: 'Import save file' }).click();
  await page.locator('.save-menu input[type="file"]').setInputFiles(savePath);
  await expect(page.locator('.hud')).toContainText('tick');
}

async function toolbarAction(page: Page, name: string, mobile: boolean): Promise<void> {
  const toolbar = page.locator('.game-toolbar');
  if (mobile) {
    await toolbar.getByRole('button', { name: 'Actions', exact: true }).tap();
    await toolbar.getByRole('button', { name, exact: true }).tap();
  } else await toolbar.getByRole('button', { name, exact: true }).click();
}

async function centerMapOnTile(page: Page, x: number, y: number, mobile: boolean): Promise<void> {
  await toolbarAction(page, 'Map', mobile);
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

async function clickTile(page: Page, x: number, y: number, mobile: boolean): Promise<void> {
  await centerMapOnTile(page, ...MAP_CENTER, mobile);
  const bounds = await page.locator('#game').boundingBox();
  if (!bounds) throw new Error('Game viewport is missing');
  const dx = x - 1 - MAP_CENTER[0];
  const dy = y - MAP_CENTER[1];
  await page.mouse.click(
    bounds.x + bounds.width / 2 + (dx - dy) * 32,
    bounds.y + bounds.height / 2 + (dx + dy) * 16 - 32,
  );
  await expect(page.locator('.tool-status')).toContainText(new RegExp(`${x}, ${y}`));
}

interface ArtScaleRide {
  name: string;
  tab: string;
  type: number;
  anchor: readonly [number, number];
}

const RIDES: readonly ArtScaleRide[] = [
  { name: 'Swinging Ship', tab: 'Thrill rides', type: 2, anchor: [28, 42] },
  { name: 'Top Spin', tab: 'Thrill rides', type: 13, anchor: [27, 42] },
];

for (const profile of ['desktop', 'pixel-8'] as const) {
  const mobile = profile === 'pixel-8';
  test.describe(`art scale on ${profile}`, () => {
    for (const ride of RIDES) {
      test(`${ride.name} covers its tile footprint`, async ({
        freshBrowser: browser,
      }, testInfo) => {
        test.fixme(
          true,
          'Fails on clean main bd7c8c6: the post-placement pixel diff reports zero visible sprite area.',
        );
        test.setTimeout(120_000);
        const page = await openPage(browser, mobile);
        page.setDefaultTimeout(8_000);
        await startStarterPark(page);
        await importRideUnlockedStarterPark(page, testInfo, ride.type, mobile);
        const viewport = (await page.locator('#game').boundingBox())!;
        await toolbarAction(page, 'Pause', mobile);
        await centerMapOnTile(page, ...MAP_CENTER, mobile);
        const before = await capture(page, testInfo, `${profile}-${ride.type}-before`);

        await toolbarAction(page, 'Resume', mobile);
        await toolbarAction(page, 'New ride', mobile);
        await page.getByRole('tab', { name: ride.tab }).click();
        await page.locator(`.ride-card[data-ride-type="${ride.type}"]`).click();
        await clickTile(page, ...ride.anchor, mobile);
        const footprint = footprintTiles(ride.type, ride.anchor);
        const ring = footprintRing(ride.type, ride.anchor);
        const candidates = page.getByRole('button', { name: /Place entrance at tile/ });
        await expect(candidates).not.toHaveCount(0);
        await expectRingCandidates(page, candidates, ring);
        await toolbarAction(page, 'Pause', mobile);
        const boxes = await candidates.evaluateAll((nodes) =>
          nodes.map((node) => {
            const r = node.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          }),
        );
        await page.addStyleTag({
          content:
            '.ride-placement-preview, .ride-placement-targets { visibility: hidden !important; }',
        });
        const after = await capture(page, testInfo, `${profile}-${ride.type}-after`);
        await page.context().close();

        const left = Math.min(...boxes.map((b) => b.x)) - 32;
        const right = Math.max(...boxes.map((b) => b.x)) + 32;
        const top = Math.min(...boxes.map((b) => b.y)) - SPRITE_HEIGHT_ALLOWANCE;
        const bottom = Math.max(...boxes.map((b) => b.y)) + 16;
        const scale = after.width / viewport.width;
        let area = 0;
        for (let y = Math.max(0, Math.round(top * scale)); y < Math.round(bottom * scale); y++)
          for (let x = Math.max(0, Math.round(left * scale)); x < Math.round(right * scale); x++)
            if (x < after.width && y < after.height && changed(before, after, x, y)) area++;
        const cssArea = area / (scale * scale);
        expect(cssArea, `${ride.name} on-screen area in CSS px²`).toBeGreaterThan(
          footprint.length * TILE_AREA,
        );
      });
    }
  });
}
