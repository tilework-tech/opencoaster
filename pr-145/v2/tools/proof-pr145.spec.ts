/**
 * Proof capture for PR 145 (stuck trains). Not part of the regular suite: it only runs when
 * PROOF_OUT is set, and it records frames instead of asserting on them.
 *
 *   PROOF_OUT=/tmp/out PROOF_KIND=steel|wooden PROOF_BACKEND=WebGL2|Canvas2D \
 *   PROOF_MODE=build|load [PROOF_SAVE=<park file to import>] [PROOF_EXPORT=<where to write the save>]
 */
import { mkdir, writeFile, appendFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { project } from '../src/render/projection';
import {
  centerCameraOn,
  clickGameTile,
  createScenarioWorld,
  dragThrough,
} from './footpath-helpers';
import type { Tile } from './footpath-helpers';
import { takeShot } from './support/shots';

const OUT = process.env.PROOF_OUT;
const KIND = process.env.PROOF_KIND === 'wooden' ? 'Wooden Coaster' : 'Steel Looping Coaster';
const BACKEND = process.env.PROOF_BACKEND === 'Canvas2D' ? 'Canvas2D' : 'WebGL2';
const MODE = process.env.PROOF_MODE === 'load' ? 'load' : 'build';
const SAVE = process.env.PROOF_SAVE;
const LABEL = process.env.PROOF_LABEL ?? 'head';
const EXPORT = process.env.PROOF_EXPORT;
const FOLLOW_SECONDS = Number(process.env.PROOF_FOLLOW_SECONDS ?? 110);
const STATION_SECONDS = Number(process.env.PROOF_STATION_SECONDS ?? 45);

const STATION: Tile = { x: 47, y: 60 };
const FIRST_PIECE: Tile = { x: 48, y: 60 };
const PARK_PATH_END: Tile = { x: 47, y: 70 };

/**
 * A flat piece starts the circuit, which closes by placing the station last. A first piece that
 * slopes would begin on a slope the closing station cannot meet.
 */
const PIECES: ReadonlyArray<readonly [string, string, string]> = [
  ['Straight', 'Level', 'Chain lift'],
  ['Straight', 'Up', 'Chain lift'],
  ['Straight', 'Level', 'Chain lift'],
  ['Right small', 'Level', 'Normal'],
  ['Straight', 'Level', 'Normal'],
  ['Right small', 'Level', 'Normal'],
  ['Straight', 'Down', 'Normal'],
  ['Straight', 'Level', 'Normal'],
  ['Straight', 'Level', 'Normal'],
  ['Straight', 'Level', 'Normal'],
  ['Right small', 'Level', 'Normal'],
  ['Straight', 'Level', 'Normal'],
  ['Right small', 'Level', 'Normal'],
  ['Station', 'Level', 'Normal'],
];

async function toolbar(page: Page, name: string): Promise<void> {
  await page.locator('.game-toolbar').getByRole('button', { name, exact: true }).click();
}

async function forceCanvas2D(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
      return original.call(this, type as '2d', ...(args as []));
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
}

/** Atlas page requests seen so far, so the capture waits for every sprite category it needs. */
function watchAtlas(page: Page): { seen: Set<string>; pending: Set<string> } {
  const seen = new Set<string>();
  const pending = new Set<string>();
  page.on('request', (r) => {
    if (r.url().includes('/sprites/')) pending.add(r.url());
  });
  page.on('requestfinished', (r) => {
    if (!r.url().includes('/sprites/')) return;
    pending.delete(r.url());
    seen.add(r.url());
  });
  page.on('requestfailed', (r) => pending.delete(r.url()));
  return { seen, pending };
}

async function waitForSprites(
  atlas: ReturnType<typeof watchAtlas>,
  categories: string[],
): Promise<void> {
  await expect
    .poll(
      () =>
        categories.every((c) => [...atlas.seen].some((u) => u.includes(`/atlas/${c}-0.png`))) &&
        atlas.pending.size === 0,
      { timeout: 60_000, intervals: [500] },
    )
    .toBe(true);
  // A category finishing a moment ago still needs a frame or two to reach the textures.
  await new Promise((r) => setTimeout(r, 4000));
}

interface Snap {
  tick: number;
  guests: number;
  cars: number[];
}

async function snap(page: Page): Promise<Snap | null> {
  // The published snapshot's buffers are transferred to the renderer, so a read can land on a
  // detached one; the next publication is a few milliseconds away.
  for (let attempt = 0; attempt < 12; attempt++) {
    const result = await page.evaluate(() => {
      try {
        const s = (
          window as unknown as {
            __snapshot: {
              tick: number;
              guests: { count: number };
              cars: { count: number; data: Int32Array };
            };
          }
        ).__snapshot;
        return {
          tick: s.tick,
          guests: s.guests.count,
          cars: Array.from(s.cars.data.slice(0, s.cars.count * 4)),
        };
      } catch {
        return null;
      }
    });
    if (result) return result;
    await new Promise((r) => setTimeout(r, 40));
  }
  return null;
}

async function setCamera(
  page: Page,
  world: ReturnType<typeof createScenarioWorld>,
  x: number,
  y: number,
  z: number,
  zoom: number,
): Promise<void> {
  const rotation = await page.evaluate(
    () => (window as unknown as { __camera: { rotation: number } }).__camera.rotation,
  );
  const out = new Float64Array(2);
  project(x, y, z, world.map.width, world.map.height, rotation as 0 | 1 | 2 | 3, out);
  await page.evaluate(
    ([cx, cy, cz]) => {
      const camera = (window as unknown as { __camera: { x: number; y: number; zoom: number } })
        .__camera;
      camera.x = cx!;
      camera.y = cy!;
      camera.zoom = cz!;
    },
    [out[0]!, out[1]!, zoom] as const,
  );
}

async function hideWindows(page: Page): Promise<void> {
  await page.addStyleTag({
    content:
      '[data-panel], .tool-status, .message-log, .hint, button[aria-label*="at tile"], .track-preview, .terrain-aids, .ride-placement-targets, .ride-placement-target, .ride-placement-preview { display: none !important; }',
  });
}

let frameNo = 0;

async function frame(page: Page, dir: string, segment: string, extra: object): Promise<void> {
  const box = await page.locator('#game').boundingBox();
  if (!box) throw new Error('no canvas');
  const w = 560;
  const h = 340;
  const shot = await takeShot(page, {
    x: box.x + box.width / 2 - w / 2,
    y: box.y + box.height / 2 - h / 2,
    width: w,
    height: h,
  });
  const name = `${String(frameNo++).padStart(4, '0')}-${segment}.png`;
  await writeFile(join(dir, name), shot.png);
  const s = (await snap(page)) ?? { tick: -1, guests: -1, cars: [] };
  await appendFile(
    join(dir, 'meta.jsonl'),
    `${JSON.stringify({ name, segment, tick: s.tick, guests: s.guests, cars: s.cars, ...extra })}\n`,
  );
}

async function followTrain(
  page: Page,
  world: ReturnType<typeof createScenarioWorld>,
  dir: string,
  seconds: number,
): Promise<void> {
  const end = Date.now() + seconds * 1000;
  let last: Snap | null = null;
  while (Date.now() < end) {
    // A read can land on a buffer the renderer holds; the last train position stands in for it.
    const s = (await snap(page)) ?? last;
    if (s) last = s;
    if (s && s.cars.length >= 4) {
      const n = s.cars.length / 4;
      let x = 0;
      let y = 0;
      let z = 0;
      for (let i = 0; i < n; i++) {
        x += s.cars[i * 4]!;
        y += s.cars[i * 4 + 1]!;
        z += s.cars[i * 4 + 2]!;
      }
      await setCamera(page, world, x / n, y / n, z / n, 2);
      await new Promise((r) => setTimeout(r, 250));
      await frame(page, dir, 'follow', {});
    } else await new Promise((r) => setTimeout(r, 500));
  }
}

async function atStation(
  page: Page,
  world: ReturnType<typeof createScenarioWorld>,
  dir: string,
  seconds: number,
  segment: string,
  interval = 700,
): Promise<void> {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    await centerCameraOn(page, world, { x: STATION.x, y: STATION.y }, 2.5);
    await frame(page, dir, segment, {});
    await new Promise((r) => setTimeout(r, interval));
  }
}

test(`pr145 proof ${KIND} ${BACKEND} ${MODE}`, async ({ page }) => {
  test.skip(!OUT, 'PROOF_OUT not set');
  test.setTimeout(1_500_000);
  page.setDefaultTimeout(15_000);
  const dir = join(
    OUT!,
    `${LABEL}-${KIND === 'Wooden Coaster' ? 'wooden' : 'steel'}-${BACKEND}-${MODE}`,
  );
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  if (BACKEND === 'Canvas2D') await forceCanvas2D(page);
  const atlas = watchAtlas(page);
  const world = createScenarioWorld('open-grounds');

  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  await page.getByRole('tab', { name: /Other Parks/ }).click();
  await page
    .locator('.scenario-card')
    .filter({ hasText: 'Open Grounds' })
    .getByRole('button', { name: 'Start', exact: true })
    .click();
  await expect(page.locator('.hud')).toContainText(BACKEND);
  await page.getByRole('button', { name: 'Close Park' }).click();

  const coasterCategory = KIND === 'Wooden Coaster' ? 'coaster-wood' : 'coaster-steel';

  if (MODE === 'load') {
    await toolbar(page, 'Save / Load');
    await page.getByRole('button', { name: 'Import save file' }).click();
    await page.locator('.save-menu input[type="file"]').setInputFiles(SAVE!);
    await expect(page.locator('.hud')).toContainText('tick');
    // The menu closes itself once the file is imported; a late Close click is harmless.
    await page
      .locator('.save-menu')
      .getByRole('button', { name: 'Close', exact: true })
      .click({ timeout: 2000 })
      .catch(() => {});
    await centerCameraOn(page, world, STATION, 2);
    await waitForSprites(atlas, [coasterCategory, 'people', 'world']);
    if (process.env.PROOF_GUESTS) {
      await toolbar(page, 'Game options');
      await page.getByRole('button', { name: 'Guests +1,000' }).click();
      await page.getByRole('button', { name: 'Close Options' }).click();
    }
    await hideWindows(page);
    await atStation(page, world, dir, 6, 'loaded', 1000);
    await followTrain(page, world, dir, FOLLOW_SECONDS);
    await atStation(page, world, dir, STATION_SECONDS, 'station');
    return;
  }

  await toolbar(page, 'New ride');
  await page.getByRole('tab', { name: 'Roller Coasters' }).click();
  await page.getByRole('button', { name: new RegExp(`^${KIND}`) }).click();
  await centerCameraOn(page, world, FIRST_PIECE, 1);
  await clickGameTile(page, world, FIRST_PIECE);
  const construction = page.locator('[data-panel="construction"]');
  await expect(construction).toBeVisible();
  let pieces = 0;
  for (const [shape, slope, drive] of PIECES) {
    if (shape === 'Station')
      await construction.getByLabel('Special elements').selectOption({ label: shape });
    else await construction.getByRole('button', { name: shape, exact: true }).click();
    await construction.getByRole('button', { name: slope, exact: true }).click();
    await construction.getByLabel('Drive').selectOption({ label: drive });
    await construction.getByRole('button', { name: 'Build piece' }).click();
    pieces++;
    await expect(page.locator('.coaster-info')).toContainText(`Track ${pieces} pieces`);
  }
  await centerCameraOn(page, world, STATION, 0.8);
  await new Promise((r) => setTimeout(r, 1500));
  await writeFile(join(dir, 'built.png'), (await takeShot(page)).png);
  await expect(page.locator('.coaster-info')).toContainText(/Circuit complete|closed circuit/);
  await waitForSprites(atlas, [coasterCategory, 'people', 'world']);
  await writeFile(join(dir, 'construction.png'), (await takeShot(page)).png);

  const title = await construction.locator('.ui-titlebar').boundingBox();
  await page.mouse.move(title!.x + 60, title!.y + 10);
  await page.mouse.down();
  await page.mouse.move(60, 500, { steps: 8 });
  await page.mouse.up();

  const place = async (expected: string, part: string): Promise<Tile> => {
    await centerCameraOn(page, world, STATION, 1);
    const target = page.getByRole('button', { name: new RegExp(`Place ${part} at tile`) }).first();
    const label = (await target.getAttribute('aria-label')) ?? '';
    const m = label.match(/tile (\d+), (\d+)/);
    if (!m) throw new Error(`no tile in ${label}`);
    await target.click();
    await expect(page.locator('.tool-status')).toContainText(expected);
    return { x: Number(m[1]), y: Number(m[2]) };
  };
  const entrance = await place('Place exit', 'entrance');
  await place('Test ride', 'exit');
  await construction.getByRole('button', { name: 'Test', exact: true }).click();
  await toolbar(page, 'Game options');
  await page.getByRole('button', { name: /4×/ }).first().click();
  await page.getByRole('button', { name: 'Close Options' }).click();
  await expect(construction).toContainText('Test complete', { timeout: 180_000 });
  await construction.getByRole('button', { name: 'Close', exact: true }).click();

  await toolbar(page, 'Footpaths');
  await page.getByRole('button', { name: 'Tarmac', exact: true }).click();
  const run = Array.from({ length: PARK_PATH_END.y - entrance.y }, (_, k) => ({
    x: PARK_PATH_END.x,
    y: PARK_PATH_END.y - k,
  }));
  await centerCameraOn(page, world, entrance, 1);
  await dragThrough(page, world, run);
  await page.mouse.up();

  // Back to 1x so the lap reads at a followable pace.
  await toolbar(page, 'Game options');
  await page.getByRole('button', { name: /1×/ }).first().click();
  await page.getByRole('button', { name: 'Close Options' }).click();

  await page.keyboard.press('Escape');
  if (await page.locator('[data-panel="paths"]').isVisible()) await toolbar(page, 'Footpaths');
  await page.mouse.click(1150, 700);
  await page.mouse.move(640, 790);
  await hideWindows(page);
  await atStation(page, world, dir, 6, 'closed-waiting', 1000);

  await page.addStyleTag({ content: '[data-panel] { display: revert !important; }' });
  await toolbar(page, 'Rides');
  await page.locator('[data-panel="ride-list"] .list-row').filter({ hasText: KIND }).click();
  const win = page.locator('[data-panel^="ride-"]:not([data-panel="ride-list"])').first();
  await win.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(win.locator('.ride-status')).toHaveText('Open');
  if (process.env.PROOF_GUESTS) {
    await toolbar(page, 'Game options');
    await page.getByRole('button', { name: 'Guests +1,000' }).click();
    await page.getByRole('button', { name: 'Close Options' }).click();
  }
  await writeFile(join(dir, 'opened.png'), (await takeShot(page)).png);

  if (EXPORT) {
    await new Promise((r) => setTimeout(r, Number(process.env.PROOF_EXPORT_WAIT ?? 25) * 1000));
    await toolbar(page, 'Save / Load');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export save file' }).click();
    await mkdir(dirname(EXPORT), { recursive: true });
    await (await download).saveAs(EXPORT);
    await page.locator('.save-menu').getByRole('button', { name: 'Close', exact: true }).click();
  }

  await page.getByRole('button', { name: /^Close Ride \d+/ }).click();
  await page.getByRole('button', { name: 'Close Rides and attractions' }).click();
  await page.keyboard.press('Escape');
  await hideWindows(page);
  await followTrain(page, world, dir, FOLLOW_SECONDS);
  await atStation(page, world, dir, STATION_SECONDS, 'station');
});
