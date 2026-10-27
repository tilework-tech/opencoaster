import { mkdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import sharp from 'sharp';
import { project, rotateOffset } from '../src/render/projection';
import type { Rotation } from '../src/render/projection';
import { TILE_UNITS, TRACK_Z_STEP, Z_STEP } from '../src/sim/core/constants';
import type { World } from '../src/sim/core/world';
import { serialize } from '../src/save/save';
import { RideType } from '../src/sim/rides/ride-types';
import { PIECES, SAMPLES } from '../src/sim/track/catalog';
import { trenchTiles } from '../src/sim/track/trench';
import { clickGameTile, createScenarioWorld, hoverGameTile, toolbarTool } from './footpath-helpers';
import type { Tile } from './footpath-helpers';
import { startOpenGrounds } from './queue-helpers';

const proofDir = process.env.TUNNEL_PROOF_DIR;
const useCanvas2d = process.env.CANVAS2D === '1';

interface Placed {
  x: number;
  y: number;
  z: number;
  dir: number;
  piece: number;
}

type Step = [shape: string, slope: string, drive?: string];

/** Open Grounds with a three-level ridge across x = 47..58, y = 46..57. */
function ridgeWorld(): World {
  const world = createScenarioWorld('open-grounds');
  const ridge = [0, 1, 2, 3, 3, 3, 3, 3, 3, 2, 1, 0];
  const map = world.map;
  for (let vy = 0; vy <= map.height; vy++)
    for (let vx = 0; vx <= map.width; vx++)
      map.vertexHeights[map.vertexIndex(vx, vy)] =
        7 + Math.min(ridge[vx - 47] ?? 0, ridge[vy - 46] ?? 0);
  for (let i = 0; i < map.width * map.height; i++) map.refreshTile(i);
  world.research.unlocked.add(RideType.WoodenCoaster);
  return world;
}

async function startPark(page: Page, testInfo: TestInfo, world: World | null): Promise<void> {
  if (useCanvas2d)
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
        if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
        return original.call(this, type as '2d', ...(args as []));
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
  await startOpenGrounds(page);
  await page.getByRole('button', { name: 'Close Park' }).click();
  if (world) {
    const savePath = testInfo.outputPath('ridge.park');
    await mkdir(testInfo.outputDir, { recursive: true });
    await writeFile(savePath, serialize(world));
    await toolbarTool(page, 'Save / Load');
    await page.getByRole('button', { name: 'Import save file' }).click();
    await page.locator('.save-menu input[type="file"]').setInputFiles(savePath);
    await expect(page.locator('.hud')).toContainText('tick');
  }
  await expect(page.locator('.hud')).toContainText(useCanvas2d ? 'Canvas2D' : 'WebGL2');
}

async function centerMapOnTile(page: Page, x: number, y: number): Promise<void> {
  await toolbarTool(page, 'Map');
  const minimap = page.locator('.minimap');
  await expect
    .poll(() => minimap.evaluate((canvas: HTMLCanvasElement) => canvas.width))
    .toBeLessThan(300);
  const bounds = (await minimap.boundingBox())!;
  const size = await minimap.evaluate((c: HTMLCanvasElement) => ({
    width: c.width,
    height: c.height,
  }));
  await minimap.click({
    position: {
      x: ((x - y + size.height - 1 + 0.5) / size.width) * bounds.width,
      y: (((x + y) / 2 + 0.25) / size.height) * bounds.height,
    },
  });
  await page.getByRole('button', { name: 'Close Map' }).click();
}

async function buildCoaster(
  page: Page,
  world: World,
  station: Tile,
  steps: Step[],
  closePanel = true,
): Promise<Placed[]> {
  await toolbarTool(page, 'New ride');
  await page.getByRole('tab', { name: 'Roller Coasters' }).click();
  await page
    .getByRole('button', { name: /^Wooden Coaster/ })
    .first()
    .click();
  await page.mouse.move(640, 20);
  await hoverGameTile(page, world, station);
  await page.waitForTimeout(300);
  await clickGameTile(page, world, station);
  const panel = page.locator('[data-panel="construction"]');
  await expect(panel).toBeVisible();
  for (const [shape, slope, drive] of steps) {
    if (shape === 'Station')
      await panel.getByLabel('Special elements').selectOption({ label: 'Station' });
    else await panel.getByRole('button', { name: shape, exact: true }).click();
    await panel.getByRole('button', { name: slope, exact: true }).click();
    await panel.getByLabel('Drive').selectOption({ label: drive ?? 'Normal' });
    const before = await page.locator('.coaster-info').innerText();
    await panel.getByRole('button', { name: 'Build piece' }).click();
    await expect(page.locator('.coaster-info')).not.toHaveText(before);
  }
  if (closePanel) await page.keyboard.press('Escape');
  return dumpTrack(page);
}

async function dumpTrack(page: Page): Promise<Placed[]> {
  return page.evaluate((trackZStep) => {
    const latest = (
      window as unknown as {
        __sim: { latest: { tracks: { count: number; data: Int32Array } } };
      }
    ).__sim.latest;
    const out: Placed[] = [];
    for (let i = 0; i < latest.tracks.count; i++) {
      const word = latest.tracks.data[i * 4 + 3]!;
      out.push({
        piece: word & 0xff,
        dir: (word >> 8) & 3,
        x: Math.floor(latest.tracks.data[i * 4]! / 256),
        y: Math.floor(latest.tracks.data[i * 4 + 1]! / 256),
        z: latest.tracks.data[i * 4 + 2]! / trackZStep,
      });
    }
    return out;
  }, TRACK_Z_STEP);
}

/** Points the camera at a tile and takes the page image for the current rotation. */
async function view(
  page: Page,
  world: World,
  focus: Tile,
): Promise<{ rotation: Rotation; image: Buffer }> {
  const rotation = (await page.evaluate(
    () => (window as unknown as { __camera: { rotation: number } }).__camera.rotation,
  )) as Rotation;
  const at = new Float64Array(2);
  project(
    (focus.x + 0.5) * TILE_UNITS,
    (focus.y + 0.5) * TILE_UNITS,
    world.map.heights[world.map.index(focus.x, focus.y)]! * Z_STEP,
    world.map.width,
    world.map.height,
    rotation,
    at,
  );
  await page.evaluate(
    ([x, y]) => {
      const camera = (window as unknown as { __camera: { x: number; y: number } }).__camera;
      camera.x = x!;
      camera.y = y!;
    },
    [at[0], at[1]],
  );
  await page.mouse.move(640, 20);
  await page.waitForTimeout(1500);
  const image = useCanvas2d
    ? Buffer.from(
        (
          await page.evaluate(() =>
            (document.querySelector('#game') as HTMLCanvasElement).toDataURL('image/png'),
          )
        ).split(',')[1]!,
        'base64',
      )
    : await page.screenshot();
  return { rotation, image };
}

async function rotateView(page: Page): Promise<void> {
  await page
    .locator('.game-toolbar')
    .getByRole('button', { name: /^Rotate right/ })
    .click();
}

interface Raw {
  data: Buffer;
  width: number;
  height: number;
  scale: number;
}

async function decode(image: Buffer, page: Page): Promise<Raw> {
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const viewport = page.viewportSize()!;
  return { data, width: info.width, height: info.height, scale: info.width / viewport.width };
}

/** Screen point, in CSS pixels, of a fixed-point world position under the page's camera. */
async function screenPoint(
  page: Page,
  world: World,
  rotation: Rotation,
  xu: number,
  yu: number,
  zu: number,
): Promise<[number, number]> {
  const camera = await page.evaluate(
    () => (window as unknown as { __camera: { x: number; y: number; zoom: number } }).__camera,
  );
  const box = (await page.locator('#game').boundingBox())!;
  const out = new Float64Array(2);
  project(xu, yu, zu, world.map.width, world.map.height, rotation, out);
  return [
    box.x + box.width / 2 + (out[0]! - camera.x) * camera.zoom,
    box.y + box.height / 2 + (out[1]! - camera.y) * camera.zoom,
  ];
}

function changedNear(a: Raw, b: Raw, cx: number, cy: number, radius: number): number {
  let changed = 0;
  for (let y = Math.floor((cy - radius) * a.scale); y <= (cy + radius) * a.scale; y++)
    for (let x = Math.floor((cx - radius) * a.scale); x <= (cx + radius) * a.scale; x++) {
      if (x < 0 || y < 0 || x >= a.width || y >= a.height) continue;
      const i = (y * a.width + x) * 4;
      const delta =
        Math.abs(a.data[i]! - b.data[i]!) +
        Math.abs(a.data[i + 1]! - b.data[i + 1]!) +
        Math.abs(a.data[i + 2]! - b.data[i + 2]!);
      if (delta > 30) changed++;
    }
  return changed;
}

function darkNear(a: Raw, cx: number, cy: number, radius: number): number {
  let dark = 0;
  for (let y = Math.floor((cy - radius) * a.scale); y <= (cy + radius) * a.scale; y++)
    for (let x = Math.floor((cx - radius) * a.scale); x <= (cx + radius) * a.scale; x++) {
      if (x < 0 || y < 0 || x >= a.width || y >= a.height) continue;
      const i = (y * a.width + x) * 4;
      if (a.data[i]! + a.data[i + 1]! + a.data[i + 2]! < 200) dark++;
    }
  return dark;
}

function worldPoint(t: Placed, k: number): [number, number, number] {
  const half = TILE_UNITS / 2;
  const [rx, ry] = rotateOffset(
    SAMPLES.x[k]! - half,
    SAMPLES.y[k]! - half,
    (t.dir & 3) as Rotation,
  );
  return [
    t.x * TILE_UNITS + half + rx,
    t.y * TILE_UNITS + half + ry,
    t.z * TRACK_Z_STEP + SAMPLES.z[k]!,
  ];
}

async function save(name: string, image: Buffer, testInfo: TestInfo): Promise<void> {
  const dir = proofDir ?? testInfo.outputDir;
  mkdirSync(dir, { recursive: true });
  await writeFile(`${dir}/${name}.png`, image);
}

const TUNNEL_STEPS: Step[] = [
  ['Station', 'Level'],
  ...Array.from({ length: 20 }, (): Step => ['Straight', 'Level']),
];

test('track built through a hill is cut into it with headwalls and has an underground view', async ({
  page,
}, testInfo) => {
  test.setTimeout(600_000);
  page.setDefaultTimeout(15_000);
  const world = ridgeWorld();
  await startPark(page, testInfo, world);
  await centerMapOnTile(page, 52, 52);
  const pieces = await buildCoaster(page, world, { x: 40, y: 52 }, TUNNEL_STEPS);
  expect(pieces).toHaveLength(TUNNEL_STEPS.length);

  const trench = trenchTiles(
    world.map,
    pieces.map((t) => ({ pieceType: t.piece, x: t.x, y: t.y, z: t.z, dir: t.dir })),
  );
  const portals = [...trench.values()].flatMap((tile) => {
    const x = tile.index % world.map.width;
    const y = (tile.index - x) / world.map.width;
    return [0, 1]
      .filter((end) => (end === 0 ? tile.lowHead : tile.highHead))
      .map((end) => ({
        x: tile.axis === 0 ? (x + end) * TILE_UNITS : x * TILE_UNITS + TILE_UNITS / 2,
        y: tile.axis === 0 ? y * TILE_UNITS + TILE_UNITS / 2 : (y + end) * TILE_UNITS,
        z: end === 0 ? tile.lowZ : tile.highZ,
        /** The headwall faces back along the open trench. */
        facing: (tile.axis + (end === 0 ? 0 : 2)) & 3,
        entering: end === 0 ? tile.highZ < tile.lowZ : tile.highZ > tile.lowZ,
      }));
  });
  expect(portals).toHaveLength(2);

  for (let turn = 0; turn < 4; turn++) {
    const { rotation, image } = await view(page, world, { x: 49, y: 52 });
    const plain = await decode(image, page);
    await save(`tunnel-rot${rotation}`, image, testInfo);
    for (const portal of portals) {
      const [px, py] = await screenPoint(page, world, rotation, portal.x, portal.y, portal.z);
      // The dark mouth shows from the side the portal opens toward; from behind, its stone back.
      const facesViewer = ((portal.facing + rotation) & 3) < 2;
      if (facesViewer)
        expect(
          darkNear(plain, px, py - 6, 9),
          `portal at ${portal.entering ? 'entry' : 'exit'} in view ${rotation}`,
        ).toBeGreaterThan(12);
    }

    await page.keyboard.press('u');
    const { image: seen } = await view(page, world, { x: 49, y: 52 });
    await save(`tunnel-rot${rotation}-underground`, seen, testInfo);
    const x = await decode(seen, page);
    const middle = pieces[8]!;
    const [mx, my] = await screenPoint(
      page,
      world,
      rotation,
      ...worldPoint(middle, PIECES[middle.piece]!.sampleStart + 2),
    );
    expect(
      changedNear(plain, x, mx, my, 5),
      `underground view reveals the buried track in view ${rotation}`,
    ).toBeGreaterThan(8);
    await page.keyboard.press('u');
    await rotateView(page);
  }
});

/** Open Grounds with one corner of the ground raised a level on the track's line. */
function cornerWorld(): World {
  const world = createScenarioWorld('open-grounds');
  const map = world.map;
  map.vertexHeights[map.vertexIndex(48, 52)] = map.vertexHeights[map.vertexIndex(48, 52)]! + 1;
  for (let i = 0; i < map.width * map.height; i++) map.refreshTile(i);
  world.research.unlocked.add(RideType.WoodenCoaster);
  return world;
}

test('track that would enter the ground through a corner is refused with a reason', async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(15_000);
  const world = cornerWorld();
  await startPark(page, testInfo, world);
  await centerMapOnTile(page, 46, 52);
  const approach: Step[] = [
    ['Station', 'Level'],
    ...Array.from({ length: 6 }, (): Step => ['Straight', 'Level']),
  ];
  const pieces = await buildCoaster(page, world, { x: 40, y: 52 }, approach, false);
  expect(pieces).toHaveLength(approach.length);

  const panel = page.locator('[data-panel="construction"]');
  await panel.getByRole('button', { name: 'Straight', exact: true }).click();
  await panel.getByRole('button', { name: 'Level', exact: true }).click();
  await panel.getByRole('button', { name: 'Build piece' }).click();
  await expect(page.locator('.coaster-feedback')).toContainText(
    'Tunnels must enter through the side of the land, not a corner',
  );
  expect(await dumpTrack(page)).toHaveLength(approach.length);
});

const OWNER_STEPS: Step[] = [
  ['Station', 'Level'],
  ['Straight', 'Level'],
  ['Left small', 'Level'],
  ['Straight', 'Level'],
  ['Straight', 'Up'],
  ['Straight', 'Up', 'Chain lift'],
  ['Straight', 'Up', 'Chain lift'],
  ['Straight', 'Up', 'Chain lift'],
  ['Straight', 'Level'],
  ['Right small', 'Level'],
  ['Straight', 'Level'],
];

test('built track is drawn on its sim centre line in every view rotation', async ({
  page,
}, testInfo) => {
  test.setTimeout(600_000);
  page.setDefaultTimeout(15_000);
  const world = createScenarioWorld('open-grounds');
  await startPark(page, testInfo, null);
  await centerMapOnTile(page, 47, 52);
  const focus = { x: 46, y: 52 };
  const empty: Raw[] = [];
  for (let turn = 0; turn < 4; turn++) {
    empty.push(await decode((await view(page, world, focus)).image, page));
    await rotateView(page);
  }
  const pieces = await buildCoaster(page, world, { x: 42, y: 56 }, OWNER_STEPS);
  expect(pieces).toHaveLength(OWNER_STEPS.length);

  for (let turn = 0; turn < 4; turn++) {
    const { rotation, image } = await view(page, world, focus);
    await save(`aligned-rot${rotation}`, image, testInfo);
    const drawn = await decode(image, page);
    let checked = 0;
    let missing = 0;
    for (const t of pieces) {
      const def = PIECES[t.piece]!;
      for (let k = def.sampleStart; k < def.sampleStart + def.sampleCount; k += 2) {
        const [px, py] = await screenPoint(page, world, rotation, ...worldPoint(t, k));
        checked++;
        if (changedNear(empty[rotation]!, drawn, px, py, 4) === 0) missing++;
      }
    }
    expect(
      missing / checked,
      `centre line points with no drawn track in view ${rotation}`,
    ).toBeLessThan(0.05);
    await rotateView(page);
  }
});
