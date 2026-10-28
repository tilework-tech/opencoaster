import { copyFileSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page, Request } from '@playwright/test';
import sharp from 'sharp';
import { project } from '../src/render/projection';
import { PieceId } from '../src/sim/track/catalog';
import { toolbarTool } from './footpath-helpers';
import { startOpenGrounds } from './queue-helpers';

/**
 * Loads a saved park with a wooden and a steel coaster, tests and opens both through the sim
 * client, and films each train: boarding, leaving the station, climbing, and finishing a lap.
 * Runs only when OWNER_PROOF_DIR names the output directory. OWNER_SAVE is the save to import,
 * PROOF_PREFIX names the image set, CANVAS2D=1 selects Canvas2D, and COASTERS names the rides to
 * film as `name:rideId` pairs.
 */
const proofDir = process.env.OWNER_PROOF_DIR;
const savePath = process.env.OWNER_SAVE;
const prefix = process.env.PROOF_PREFIX ?? 'proof';
const useCanvas2d = process.env.CANVAS2D === '1';
const renderer = useCanvas2d ? 'canvas2d' : 'webgl2';
const coasters = (process.env.COASTERS ?? 'wooden:12,steel:13').split(',').map((pair) => {
  const [name, id] = pair.split(':');
  return { name: name!, rideId: Number(id) };
});

const FRAME = { width: 520, height: 340 };
const STAGES = ['boarding', 'leaving', 'climbing', 'lap-done'] as const;
type Stage = (typeof STAGES)[number];

interface Reading {
  tiles: [number, number, number];
  riders: number;
  cars: number;
}

interface SimWindow {
  __sim: {
    latest: {
      cars: { data: Int32Array; count: number };
      tracks: { data: Int32Array; count: number };
      rideInfo: Int32Array;
      rides: { count: number };
    };
    map: { width: number; height: number };
    command(command: unknown): void;
    setSpeed(multiplier: number): void;
    setPaused(paused: boolean): void;
  };
  __camera: { x: number; y: number; zoom: number; rotation: number };
}

const RIDE_INFO_STRIDE = 39;

async function readTrain(page: Page, rideId: number): Promise<Reading | null> {
  return page.evaluate((id) => {
    const { cars } = (window as unknown as SimWindow).__sim.latest;
    let x = 0;
    let y = 0;
    let z = 0;
    let n = 0;
    let riders = 0;
    for (let i = 0; i < cars.count; i++) {
      const pose = cars.data[i * 4 + 3]!;
      if (pose >>> 16 !== id) continue;
      x += cars.data[i * 4]!;
      y += cars.data[i * 4 + 1]!;
      z += cars.data[i * 4 + 2]!;
      riders += (pose >> 9) & 7;
      n++;
    }
    return n === 0 ? null : { tiles: [x / n / 256, y / n / 256, z / n / 64], riders, cars: n };
  }, rideId) as Promise<Reading | null>;
}

async function rideInfo(
  page: Page,
  rideId: number,
): Promise<{ flags: number; state: number; served: number }> {
  return page.evaluate(
    ([id, stride]) => {
      const { rideInfo, rides } = (window as unknown as SimWindow).__sim.latest;
      for (let i = 0; i < rides.count; i++)
        if (rideInfo[i * stride!] === id)
          return {
            state: rideInfo[i * stride! + 2]!,
            flags: rideInfo[i * stride! + 8]!,
            served: rideInfo[i * stride! + 9]!,
          };
      throw new Error(`ride ${id} missing`);
    },
    [rideId, RIDE_INFO_STRIDE] as const,
  );
}

async function trackTiles(page: Page, rideId: number) {
  return page.evaluate((id) => {
    const { tracks } = (window as unknown as SimWindow).__sim.latest;
    const out: Array<{ x: number; y: number; type: number; mode: number }> = [];
    for (let i = 0; i < tracks.count; i++) {
      const word = tracks.data[i * 4 + 3]!;
      if (word >>> 16 !== id) continue;
      out.push({
        x: Math.floor(tracks.data[i * 4]! / 256),
        y: Math.floor(tracks.data[i * 4 + 1]! / 256),
        type: word & 0xff,
        mode: (word >> 10) & 7,
      });
    }
    return out;
  }, rideId);
}

async function aim(
  page: Page,
  tile: readonly [number, number, number],
  zoom: number,
): Promise<void> {
  const { width, height, rotation } = await page.evaluate(() => {
    const w = window as unknown as SimWindow;
    return { width: w.__sim.map.width, height: w.__sim.map.height, rotation: w.__camera.rotation };
  });
  const at = new Float64Array(2);
  project(tile[0] * 256, tile[1] * 256, tile[2] * 64, width, height, rotation as 0, at);
  await page.evaluate(
    ([x, y, z]) => {
      const camera = (window as unknown as SimWindow).__camera;
      camera.x = x!;
      camera.y = y!;
      camera.zoom = z!;
    },
    [at[0], at[1], zoom],
  );
  await page.mouse.move(5, 5);
}

/** Every sprite page the renderer asked for has been served and nothing new has been asked for lately. */
function spriteIdleTracker(page: Page) {
  let pending = 0;
  let lastActivity = Date.now();
  const isAtlas = (request: Request) =>
    /\/sprites\/(atlas|rides|paths|litter)\//.test(request.url());
  page.on('request', (request) => {
    if (!isAtlas(request)) return;
    pending++;
    lastActivity = Date.now();
  });
  const done = (request: Request) => {
    if (!isAtlas(request)) return;
    pending--;
    lastActivity = Date.now();
  };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return async () => {
    const deadline = Date.now() + 60_000;
    while (pending > 0 || Date.now() - lastActivity < 1200) {
      if (Date.now() > deadline) throw new Error('sprite pages did not finish loading');
      await page.waitForTimeout(100);
    }
  };
}

async function capture(page: Page): Promise<Buffer> {
  const canvas = page.locator('#game');
  const box = (await canvas.boundingBox())!;
  const clip = {
    x: Math.max(0, box.x + box.width / 2 - FRAME.width / 2),
    y: Math.max(0, box.y + box.height / 2 - FRAME.height / 2),
    width: FRAME.width,
    height: FRAME.height,
  };
  if (!useCanvas2d) return page.screenshot({ clip });
  const url = await page.evaluate(() =>
    (document.querySelector('#game') as HTMLCanvasElement).toDataURL('image/png'),
  );
  const image = Buffer.from(url.split(',')[1]!, 'base64');
  const meta = await sharp(image).metadata();
  const scale = meta.width! / box.width;
  const left = Math.round((clip.x - box.x) * scale);
  const top = Math.round((clip.y - box.y) * scale);
  return sharp(image)
    .extract({
      left,
      top,
      width: Math.round(clip.width * scale),
      height: Math.round(clip.height * scale),
    })
    .resize({ width: FRAME.width })
    .png()
    .toBuffer();
}

async function strip(frames: Array<{ label: string; image: Buffer }>): Promise<Buffer> {
  const labelHeight = 26;
  const composites = await Promise.all(
    frames.map(async ({ label, image }, index) => {
      const labelled = await sharp({
        create: { width: FRAME.width, height: labelHeight, channels: 4, background: '#10151b' },
      })
        .composite([
          {
            input: Buffer.from(
              `<svg width="${FRAME.width}" height="${labelHeight}"><text x="8" y="18" font-family="sans-serif" font-size="15" fill="#f4f0dd">${label}</text></svg>`,
            ),
          },
        ])
        .png()
        .toBuffer();
      return [
        { input: labelled, left: index * (FRAME.width + 4), top: 0 },
        {
          input: await sharp(image).resize(FRAME.width, FRAME.height).png().toBuffer(),
          left: index * (FRAME.width + 4),
          top: labelHeight,
        },
      ];
    }),
  );
  return sharp({
    create: {
      width: frames.length * (FRAME.width + 4),
      height: FRAME.height + labelHeight,
      channels: 4,
      background: '#10151b',
    },
  })
    .composite(composites.flat())
    .png()
    .toBuffer();
}

test.use({
  viewport: { width: 1024, height: 600 },
  launchOptions: {
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage',
    ],
  },
});

test('the saved park coasters test, open and carry guests', async ({ page }, testInfo) => {
  test.skip(!proofDir || !savePath, 'set OWNER_PROOF_DIR and OWNER_SAVE');
  test.setTimeout(900_000);
  mkdirSync(proofDir!, { recursive: true });
  if (useCanvas2d)
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
        if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
        return original.call(this, type as '2d', ...(args as []));
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
  const spritesIdle = spriteIdleTracker(page);
  await startOpenGrounds(page);
  const importPath = testInfo.outputPath('park.park');
  mkdirSync(testInfo.outputDir, { recursive: true });
  copyFileSync(savePath!, importPath);
  await toolbarTool(page, 'Save / Load');
  await page.getByRole('button', { name: 'Import save file' }).click();
  await page.locator('.save-menu input[type="file"]').setInputFiles(importPath);
  await expect(page.locator('.hud')).toContainText('tick');
  await expect(page.locator('.hud')).toContainText(useCanvas2d ? 'Canvas2D' : 'WebGL2');
  await page.evaluate(() => (window as unknown as SimWindow).__sim.setSpeed(1));

  await expect
    .poll(
      () =>
        page.evaluate(() => ((window as unknown as SimWindow).__sim.latest?.rides.count ?? 0) > 20),
      {
        timeout: 60_000,
      },
    )
    .toBe(true);

  const log: string[] = [];
  const note = (line: string) => {
    log.push(line);
  };
  const before = await Promise.all(coasters.map((c) => rideInfo(page, c.rideId)));
  note(`on load: ${JSON.stringify(before)}`);

  const TESTED = 1 << 3;
  const OPEN = 1;
  const infos = await Promise.all(
    coasters.map(async (c) => ({ c, info: await rideInfo(page, c.rideId) })),
  );
  const untested = infos.filter(({ info }) => !(info.flags & TESTED)).map(({ c }) => c.rideId);
  await page.evaluate((ids) => {
    const sim = (window as unknown as SimWindow).__sim;
    sim.setSpeed(8);
    for (const rideId of ids) sim.command({ type: 'setRideStatus', rideId, status: 'test' });
  }, untested);
  for (const rideId of untested)
    await expect
      .poll(async () => (await rideInfo(page, rideId)).flags & TESTED, { timeout: 240_000 })
      .toBe(TESTED);
  note(
    `tested: ${JSON.stringify(await Promise.all(coasters.map((c) => rideInfo(page, c.rideId))))}`,
  );
  const closed = (
    await Promise.all(coasters.map(async (c) => ({ c, info: await rideInfo(page, c.rideId) })))
  )
    .filter(({ info }) => info.state !== OPEN)
    .map(({ c }) => c.rideId);
  await page.evaluate((ids) => {
    const sim = (window as unknown as SimWindow).__sim;
    for (const rideId of ids) sim.command({ type: 'setRideStatus', rideId, status: 'open' });
  }, closed);
  for (const c of coasters)
    await expect
      .poll(async () => (await rideInfo(page, c.rideId)).state, { timeout: 30_000 })
      .toBe(OPEN);

  const station = new Map<number, Array<{ x: number; y: number }>>();
  const lifts = new Map<number, Set<string>>();
  for (const c of coasters) {
    const tiles = await trackTiles(page, c.rideId);
    station.set(
      c.rideId,
      tiles.filter((t) => t.type === PieceId.Station),
    );
    lifts.set(
      c.rideId,
      new Set(tiles.filter((t) => t.mode === 1 || t.mode === 4).map((t) => `${t.x},${t.y}`)),
    );
  }
  const nearStation = (rideId: number, r: Reading, reach: number) =>
    station
      .get(rideId)!
      .some((t) => Math.hypot(r.tiles[0] - (t.x + 0.5), r.tiles[1] - (t.y + 0.5)) <= reach);

  const frames = new Map<number, Map<Stage, Buffer>>(coasters.map((c) => [c.rideId, new Map()]));
  const progress = new Map(
    await Promise.all(
      coasters.map(
        async (c) =>
          [c.rideId, { away: 0, served: (await rideInfo(page, c.rideId)).served }] as const,
      ),
    ),
  );
  await page.evaluate(() => (window as unknown as SimWindow).__sim.setSpeed(2));
  let lastTrace = 0;
  const deadline = Date.now() + 700_000;
  while (
    Date.now() < deadline &&
    coasters.some((c) => frames.get(c.rideId)!.size < STAGES.length)
  ) {
    await page.waitForTimeout(120);
    for (const c of coasters) {
      const have = frames.get(c.rideId)!;
      const reading = await readTrain(page, c.rideId);
      if (!reading) continue;
      const here = progress.get(c.rideId)!;
      const info = await rideInfo(page, c.rideId);
      const home = nearStation(c.rideId, reading, 0.9);
      if (Date.now() - lastTrace > 3000) {
        lastTrace = Date.now();
        note(
          `trace ${c.name}: ${reading.tiles.map((v) => v.toFixed(1)).join(',')} riders=${reading.riders} served=${info.served} state=${info.state}`,
        );
      }
      if (!home) here.away = Math.max(here.away, 1);
      const lift = lifts
        .get(c.rideId)!
        .has(`${Math.floor(reading.tiles[0])},${Math.floor(reading.tiles[1])}`);
      let stage: Stage | null = null;
      if (!have.has('boarding') && home) stage = 'boarding';
      else if (
        !have.has('leaving') &&
        reading.riders > 0 &&
        !nearStation(c.rideId, reading, 3.2) &&
        nearStation(c.rideId, reading, 9)
      )
        stage = 'leaving';
      else if (!have.has('climbing') && reading.riders > 0 && lift) stage = 'climbing';
      else if (!have.has('lap-done') && home && info.served > here.served) stage = 'lap-done';
      if (!stage) continue;
      await page.evaluate(() => (window as unknown as SimWindow).__sim.setPaused(true));
      await aim(page, reading.tiles, 1);
      if (have.size === 0) {
        await page.waitForTimeout(2000);
        await aim(page, reading.tiles, 1);
      }
      await page.waitForTimeout(1500);
      await spritesIdle();
      let image = await capture(page);
      for (
        let retry = 0;
        retry < 6 && (await sharp(image).stats()).channels[0]!.stdev < 4;
        retry++
      ) {
        await page.evaluate(() => (window as unknown as SimWindow).__sim.setPaused(false));
        await page.waitForTimeout(1000);
        await page.evaluate(() => (window as unknown as SimWindow).__sim.setPaused(true));
        await aim(page, reading.tiles, 1);
        await page.waitForTimeout(1500);
        image = await capture(page);
      }
      have.set(stage, image);
      note(
        `${c.name} ${stage}: tiles=${reading.tiles.map((v) => v.toFixed(1)).join(',')} riders=${reading.riders} served=${info.served}`,
      );
      await page.evaluate(() => (window as unknown as SimWindow).__sim.setPaused(false));
    }
  }

  for (const c of coasters) {
    const have = frames.get(c.rideId)!;
    const ordered = STAGES.filter((s) => have.has(s)).map((s) => ({
      label: `${c.name} (${renderer}) - ${s}`,
      image: have.get(s)!,
    }));
    for (const f of ordered)
      await writeFile(
        `${proofDir}/${prefix}-${renderer}-${c.name}-${f.label.split(' - ')[1]}.png`,
        f.image,
      );
    if (ordered.length)
      await writeFile(
        `${proofDir}/${prefix}-${renderer}-${c.name}-strip.png`,
        await strip(ordered),
      );
    note(`${c.name}: frames ${ordered.map((f) => f.label.split(' - ')[1]).join(', ')}`);
  }
  note(
    `final: ${JSON.stringify(await Promise.all(coasters.map((c) => rideInfo(page, c.rideId))))}`,
  );
  await writeFile(`${proofDir}/${prefix}-${renderer}-log.txt`, log.join('\n') + '\n');
  for (const c of coasters)
    expect(frames.get(c.rideId)!.size, `${c.name} frames`).toBe(STAGES.length);
});
