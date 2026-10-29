import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import sharp from 'sharp';

/**
 * Renders a busy lamp-lit path at day, dusk and night in both renderers and every rotation, and
 * times frames with ~200 lamps. Runs only when NIGHT_PROOF_DIR names the output directory.
 * NIGHT_BENCH=1 runs the frame-time benchmark instead of the captures.
 */
const proofDir = process.env.NIGHT_PROOF_DIR;
const bench = process.env.NIGHT_BENCH === '1';
const CELL = { width: 640, height: 400 };
const TIMES = ['day', 'dusk', 'night'] as const;
type TimeOfDay = (typeof TIMES)[number];
const HOURS: Record<TimeOfDay, number> = { day: 12, dusk: 19.5, night: 0 };
type Backend = 'webgl2' | 'canvas2d';
type Rot = 0 | 1 | 2 | 3;
type DrawFn = (
  b: Backend,
  hour: number,
  rotation: Rot,
  zoom: number,
  lit: boolean,
) => HTMLCanvasElement;
type CaptureFn = (b: Backend, hour: number, rotation: number) => string;
type TimeFn = (
  b: Backend,
  hour: number,
  zoom: number,
  lit: boolean,
  frames: number,
) => { median: number; p95: number };
const BACKENDS = ['webgl2', 'canvas2d'] as const;

test('Canvas2D lamp lighting follows lamps as their positions change', async ({ page }) => {
  await page.goto('/');
  const colors = await page.evaluate(async () => {
    const [{ CanvasNightPass }, { LampLightBuffer }] = await Promise.all([
      import('../src/render/night-pass-canvas'),
      import('../src/render/night-lighting'),
    ]);
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const pass = new CanvasNightPass();
    const lights = new LampLightBuffer();
    lights.push(0, 32, 32);
    const draw = () => {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      pass.draw(ctx, 1, lights, 1, 1, 1);
    };
    const brightnessAt = (x: number) => {
      const [r, g, b] = ctx.getImageData(x, 32, 1, 1).data;
      return r! + g! + b!;
    };
    draw();
    const original = brightnessAt(32);
    lights.data[0] = 96;
    draw();
    return { original, old: brightnessAt(32), moved: brightnessAt(96) };
  });
  expect(colors.original).toBeGreaterThan(0);
  expect(colors.old).toBe(0);
  expect(colors.moved).toBeGreaterThan(0);
});

async function setUp(
  page: Page,
  only: 'webgl2' | 'canvas2d',
  requiredCategories?: readonly string[],
): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    async ({ cell, noGuests, only, requiredCategories, skip }) => {
      const [
        { Canvas2DRenderer },
        { WebGL2Renderer },
        { spritePages },
        { createSnapshot, writeSnapshot },
        { flatOwnedSim },
        { placePath, setPathAddition, PathAddition },
        { markPathElementBroken },
        { extractMapData },
        { project },
        lighting,
      ] = await Promise.all([
        import('../src/render/canvas2d-renderer'),
        import('../src/render/webgl2-renderer'),
        import('../src/render/sprite-pages.ts'),
        import('../src/worker/snapshot'),
        import('../src/sim/rides/coaster-fixtures'),
        import('../src/sim/map/paths'),
        import('../src/sim/map/tile-map'),
        import('../src/worker/map-data'),
        import('../src/render/projection'),
        import('../src/render/night-lighting'),
      ]);
      spritePages.start();
      const manifest = await fetch('/sprites/manifest.json').then((response) => response.json());
      while (spritePages.pageInfos.length === 0) await new Promise((r) => setTimeout(r, 25));
      const missingCategories = (requiredCategories ?? []).filter(
        (category) => !manifest.categories[category],
      );
      if (missingCategories.length > 0)
        throw new Error(`required sprite categories are missing: ${missingCategories.join(', ')}`);
      const categories = Object.keys(manifest.categories).filter((category) =>
        requiredCategories ? requiredCategories.includes(category) : !skip.includes(category),
      );
      for (const category of categories) spritePages.requestCategory(category);

      const sim = flatOwnedSim(1);
      const map = sim.world.map;
      const ROWS = [10, 16, 22, 28];
      const FIRST = 10;
      const LAST = 35;
      let broken = 0;
      for (const y of ROWS)
        for (let x = FIRST; x <= LAST; x++) {
          placePath(map, { x, y, queue: false });
          setPathAddition(map, x, y, PathAddition.Lamp);
          if ((x + y) % 12 === 0) {
            markPathElementBroken(map, map.pathElement(map.index(x, y), -1));
            broken++;
          }
        }
      const snapshot = createSnapshot({
        guests: 300,
        staff: 0,
        vehicles: 0,
        cars: 0,
        litter: 0,
        rides: 0,
        tracks: 0,
        mapTiles: 48 * 48,
      });
      writeSnapshot(sim.world, snapshot);
      let guests = 0;
      for (const y of ROWS)
        for (let x = FIRST; x <= LAST; x += 2) {
          snapshot.guests.data.set([x * 256 + 128, y * 256 + 100 + (x % 3) * 20, 0, 0], guests * 4);
          guests++;
        }
      snapshot.guests.count = noGuests ? 0 : guests;
      const mapData = extractMapData(map);

      const make = (id: string, renderer: InstanceType<typeof Canvas2DRenderer>) => {
        const canvas = document.createElement('canvas');
        canvas.id = id;
        canvas.style.cssText = `position:fixed;left:0;top:0;width:${cell.width}px;height:${cell.height}px;z-index:1000000`;
        document.body.append(canvas);
        renderer.attach(canvas);
        renderer.resize(cell.width, cell.height, 1);
        renderer.setMap(mapData);
        return { canvas, renderer };
      };
      const backends = {} as Record<
        'webgl2' | 'canvas2d',
        { canvas: HTMLCanvasElement; renderer: InstanceType<typeof Canvas2DRenderer> }
      >;
      const stores: (typeof spritePages)[] = [spritePages];
      if (only === 'webgl2')
        backends.webgl2 = make(
          'night-webgl2',
          new WebGL2Renderer() as unknown as InstanceType<typeof Canvas2DRenderer>,
        );
      else {
        backends.canvas2d = make('night-canvas2d', new Canvas2DRenderer());
        stores.push((backends.canvas2d.renderer as unknown as { atlas: typeof spritePages }).atlas);
      }
      const deadline = Date.now() + 120_000;
      for (const store of stores) {
        while (store.pageInfos.length === 0) await new Promise((r) => setTimeout(r, 25));
        for (const category of categories) store.requestCategory(category);
        while (categories.some((c) => !store.isLoaded(c))) {
          if (Date.now() > deadline) throw new Error('sprite categories did not finish loading');
          await new Promise((r) => setTimeout(r, 100));
        }
      }

      const tickAt = (hour: number) =>
        Math.round((((((hour - 8) / 24) % 1) + 1) % 1) * lighting.TICKS_PER_NIGHT_CYCLE);
      const centre = (rotation: 0 | 1 | 2 | 3) => {
        const out = new Float64Array(2);
        project(22 * 256 + 128, 19 * 256, 4 * 64, 48, 48, rotation, out);
        return out;
      };
      const lamps = { broken, total: ROWS.length * (LAST - FIRST + 1) * 2 };
      (window as unknown as { __night: unknown }).__night = {
        lamps,
        darkness: (hour: number) => lighting.darknessAt(tickAt(hour)),
        draw(
          backend: 'webgl2' | 'canvas2d',
          hour: number,
          rotation: 0 | 1 | 2 | 3,
          zoom: number,
          lit: boolean,
        ) {
          snapshot.tick = tickAt(hour);
          const { renderer, canvas } = backends[backend];
          const at = centre(rotation);
          renderer.draw(snapshot, {
            x: at[0]!,
            y: at[1]!,
            zoom,
            rotation,
            dayNight: lit,
            lampLights: lit,
          });
          return canvas;
        },
        capture(backend: 'webgl2' | 'canvas2d', hour: number, rotation: 0 | 1 | 2 | 3) {
          const canvas = (window as unknown as { __night: { draw: DrawFn } }).__night.draw(
            backend,
            hour,
            rotation,
            1,
            true,
          ) as HTMLCanvasElement;
          return canvas.toDataURL('image/png');
        },
        time(
          backend: 'webgl2' | 'canvas2d',
          hour: number,
          zoom: number,
          lit: boolean,
          frames: number,
        ) {
          const api = (window as unknown as { __night: { draw: DrawFn } }).__night;
          const sync = (canvas: HTMLCanvasElement) => {
            if (backend === 'webgl2') {
              const gl = canvas.getContext('webgl2')!;
              gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
            } else {
              canvas.getContext('2d')!.getImageData(0, 0, 1, 1);
            }
          };
          for (let i = 0; i < 5; i++) sync(api.draw(backend, hour, 0, zoom, lit));
          const samples: number[] = [];
          for (let i = 0; i < frames; i++) {
            const start = performance.now();
            sync(api.draw(backend, hour, 0, zoom, lit));
            samples.push(performance.now() - start);
          }
          samples.sort((a, b) => a - b);
          return {
            median: samples[samples.length >> 1]!,
            p95: samples[Math.floor(samples.length * 0.95)]!,
          };
        },
      };
    },
    {
      cell: CELL,
      noGuests: false,
      only,
      requiredCategories,
      skip: (process.env.NIGHT_SKIP_CATEGORIES ?? '').split(',').filter(Boolean),
    },
  );
}

for (const backend of BACKENDS) {
  test(`night and weather remain readable together: ${backend}`, async ({ page }) => {
    test.setTimeout(120_000);
    await setUp(page, backend, ['people', 'world']);
    const overlays = await page.evaluate(() => {
      const overlay = document.createElement('div');
      overlay.className = 'weather-overlay weather-sunny';
      overlay.style.zIndex = '1000001';
      document.body.append(overlay);
      return ['sunny', 'rain', 'storm'] as const;
    });
    const brightness: Record<string, number> = {};
    const pathAndGuestBrightness: Record<string, number> = {};
    for (const weather of overlays) {
      await page.evaluate(
        ([b, h, state]) => {
          (window as unknown as { __night: { draw: DrawFn } }).__night.draw(b, h, 0, 1, true);
          const overlay = document.querySelector('.weather-overlay')!;
          overlay.className = `weather-overlay weather-${state}`;
        },
        [backend, 12, weather] as const,
      );
      const screenshot = await page.screenshot({
        clip: { x: 0, y: 0, width: CELL.width, height: CELL.height },
        animations: 'disabled',
      });
      brightness[`${weather}-day`] =
        (await sharp(screenshot).stats()).channels
          .slice(0, 3)
          .reduce((sum, channel) => sum + channel.mean, 0) / 3;
      pathAndGuestBrightness[`${weather}-day`] =
        (
          await sharp(screenshot).extract({ left: 376, top: 128, width: 56, height: 64 }).stats()
        ).channels
          .slice(0, 3)
          .reduce((sum, channel) => sum + channel.mean, 0) / 3;
    }
    for (const weather of ['sunny', 'rain', 'storm'] as const) {
      await page.evaluate(
        ([b, state]) => {
          (window as unknown as { __night: { draw: DrawFn } }).__night.draw(b, 0, 0, 1, true);
          document.querySelector('.weather-overlay')!.className =
            `weather-overlay weather-${state}`;
        },
        [backend, weather] as const,
      );
      const screenshot = await page.screenshot({
        clip: { x: 0, y: 0, width: CELL.width, height: CELL.height },
        animations: 'disabled',
      });
      brightness[`${weather}-night`] =
        (await sharp(screenshot).stats()).channels
          .slice(0, 3)
          .reduce((sum, channel) => sum + channel.mean, 0) / 3;
      pathAndGuestBrightness[`${weather}-night`] =
        (
          await sharp(screenshot).extract({ left: 376, top: 128, width: 56, height: 64 }).stats()
        ).channels
          .slice(0, 3)
          .reduce((sum, channel) => sum + channel.mean, 0) / 3;
    }
    expect(brightness['rain-day']!).toBeGreaterThan(brightness['sunny-day']! * 0.88);
    expect(brightness['sunny-night']!).toBeGreaterThan(brightness['sunny-day']! * 0.55);
    expect(brightness['rain-night']!).toBeGreaterThan(brightness['sunny-day']! * 0.55);
    expect(brightness['storm-night']!).toBeGreaterThan(brightness['sunny-day']! * 0.5);
    expect(pathAndGuestBrightness['rain-night']!).toBeGreaterThan(
      pathAndGuestBrightness['sunny-day']! * 0.55,
    );
    expect(pathAndGuestBrightness['storm-night']!).toBeGreaterThan(
      pathAndGuestBrightness['sunny-day']! * 0.5,
    );
  });

  test(`night lamps proof: ${backend}`, async ({ page }) => {
    test.skip(!proofDir || bench, 'set NIGHT_PROOF_DIR to render proof images');
    test.setTimeout(900_000);
    await mkdir(proofDir!, { recursive: true });
    await setUp(page, backend);
    const cells: Buffer[] = [];
    const brightness: Partial<Record<TimeOfDay, number>> = {};
    for (const time of TIMES)
      for (let rotation = 0; rotation < 4; rotation++) {
        const url = await page.evaluate(
          ([b, h, r]) =>
            (window as unknown as { __night: { capture: CaptureFn } }).__night.capture(b, h, r),
          [backend, HOURS[time], rotation] as const,
        );
        const png = Buffer.from((url as string).split(',')[1]!, 'base64');
        const stats = await sharp(png).stats();
        expect(stats.channels.slice(0, 3).some((channel) => channel.max > 0)).toBe(true);
        if (rotation === 0)
          brightness[time] =
            stats.channels.slice(0, 3).reduce((sum, channel) => sum + channel.mean, 0) / 3;
        await writeFile(join(proofDir!, `${backend}-${time}-rot${rotation}.png`), png);
        cells.push(png);
      }
    expect(brightness.dusk).toBeLessThan(brightness.day!);
    expect(brightness.night).toBeLessThan(brightness.dusk!);
    await sharp({
      create: { width: CELL.width * 4, height: CELL.height * 3, channels: 3, background: '#000' },
    })
      .composite(
        cells.map((input, i) => ({
          input,
          left: (i % 4) * CELL.width,
          top: Math.floor(i / 4) * CELL.height,
        })),
      )
      .png()
      .toFile(join(proofDir!, `${backend}-sheet.png`));
  });

  test(`night lamps frame time: ${backend}`, async ({ page }) => {
    test.skip(!bench, 'set NIGHT_BENCH=1 to time frames');
    test.setTimeout(900_000);
    await setUp(page, backend);
    const results: Record<string, unknown> = {};
    results.lamps = await page.evaluate(
      () => (window as unknown as { __night: { lamps: unknown } }).__night.lamps,
    );
    for (const [label, hour, lit] of (
      [
        ['day-off', 12, false],
        ['day-on', 12, true],
        ['dusk-on', 19.5, true],
        ['night-on', 0, true],
        ['night-off', 0, false],
      ] as const
    )
      .slice()
      [process.env.NIGHT_REVERSE ? 'reverse' : 'slice']()) {
      const runs = [];
      for (let run = 0; run < 3; run++)
        runs.push(
          await page.evaluate(
            ([b, h, l]) =>
              (window as unknown as { __night: { time: TimeFn } }).__night.time(b, h, 0.6, l, 40),
            [backend, hour, lit] as const,
          ),
        );
      results[label] = runs;
    }
    for (const run of results['day-on'] as Array<{ median: number }>)
      expect(run.median).toBeGreaterThan(1);
    console.log(`NIGHT_BENCH_RESULT ${backend} ${JSON.stringify(results)}`);
    expect(Object.keys(results).length).toBeGreaterThan(1);
    if (backend === 'canvas2d') {
      const medians = (label: string) =>
        (results[label] as Array<{ median: number }>)
          .map((run) => run.median)
          .sort((a, b) => a - b);
      const day = medians('day-on');
      const night = medians('night-on');
      expect(night[1]!).toBeLessThanOrEqual(day[1]! * 1.1);
    }
  });
}
