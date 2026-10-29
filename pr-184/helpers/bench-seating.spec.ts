import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { expect, test } from './support/test';
import type { Page } from './support/test';
import { importWorld, savedWorld, startStarterPark, toolbarAction } from './support/park';
import { tileScreenPoint } from './footpath-helpers';
import { createBalancePark } from '../bench/balance-park';
import { TICKS_PER_MONTH } from '../src/sim/economy/calendar';
import { serialize, deserialize } from '../src/save/save';
import { project } from '../src/render/projection';
import type { Rotation } from '../src/render/projection';
import { PATH_SURFACE_Z } from '../src/render/ground-anchor';
import { TILE_UNITS, Z_STEP } from '../src/sim/core/constants';
import { ElementType, PathFlag } from '../src/sim/map/tile-map';
import { RideType } from '../src/sim/rides/ride-types';
import type { World } from '../src/sim/core/world';
import { isSeated } from '../src/sim/guests/resting';
import { PathAddition, setPathAddition } from '../src/sim/map/paths';
import { flatWorld, guestAt, layPath, row } from '../src/sim/integration/fixtures';

/**
 * Natural bench use in a running park. An ordinary scripted park is imported, benches are placed
 * through the Scenery window, the game then runs at 4x and the page's own snapshots are logged:
 * every guest that walks to a seat, sits and later rises is counted. Nothing about the guests is
 * edited. Set BENCH_PROOF_DIR to run it; it writes the report, close-ups in all four rotations and
 * a frame sequence of one guest sitting down there.
 *
 * The WebGL2 run uses a park without flat rides: software WebGL2 keeps every loaded atlas page in
 * memory twice and the flat-ride pages alone exhaust small CI and sandbox machines.
 */
const proofDir = process.env.BENCH_PROOF_DIR;
const RUN_TICKS = Number(process.env.BENCH_PROOF_TICKS ?? 24_000);
const MAX_WALL_MS = Number(process.env.BENCH_PROOF_MAX_MS ?? 600_000);
const BENCHES = 10;
const CLIP = { width: 140, height: 110, scale: 6 };

interface Session {
  heading: number;
  start: number;
  seatedAt: number;
  end: number;
  x: number;
  y: number;
}

interface BenchLog {
  firstTick: number;
  lastTick: number;
  sessions: Record<string, Session>;
  /** Guest ids walking to a seat (negative) or seated (positive) in the newest snapshot. */
  sittingNow: number[];
}

function parkBytes(flatRides: boolean): Uint8Array {
  const park = createBalancePark({ seed: 1, profile: 'sensible' });
  for (let i = 0; i < TICKS_PER_MONTH * 2; i++) {
    park.runSchedule();
    park.sim.step();
    if (!flatRides && i === 60) {
      const rides = park.sim.world.rides;
      for (let slot = 0; slot < rides.count; slot++) {
        const type = rides.cols.typeId[slot] as RideType;
        if (
          type !== RideType.FoodStall &&
          type !== RideType.DrinkStall &&
          type !== RideType.Toilets
        )
          park.sim.enqueue({ type: 'demolishRide', rideId: rides.slotToId[slot]! });
      }
    }
  }
  return serialize(park.sim.world);
}

function benchCandidates(world: World): Array<{ x: number; y: number }> {
  const map = world.map;
  const out: Array<{ x: number; y: number }> = [];
  for (let tile = 0; tile < map.width * map.height; tile++) {
    for (let e = map.firstElement(tile); e >= 0; e = map.elNext[e]) {
      if (map.elType[e] !== ElementType.Path) continue;
      const flags = map.elFlags[e]!;
      if (flags & (PathFlag.Queue | PathFlag.Sloped | PathFlag.Bin | PathFlag.Lamp)) break;
      if ((map.pathEdgesOf(e) & 0xf) === 0xf) break;
      out.push({ x: tile % map.width, y: Math.floor(tile / map.width) });
      break;
    }
  }
  return out;
}

async function watchSnapshots(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log: BenchLog = { firstTick: -1, lastTick: 0, sessions: {}, sittingNow: [] };
    (window as unknown as { __benchLog: BenchLog }).__benchLog = log;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        this.addEventListener('message', (event: MessageEvent) => {
          const snapshot = event.data?.type === 'snapshot' ? event.data.snapshot : null;
          if (!snapshot?.guests) return;
          const tick: number = snapshot.tick;
          if (log.firstTick < 0) log.firstTick = tick;
          log.lastTick = tick;
          const now: number[] = [];
          for (let row = 0; row < snapshot.guests.count; row++) {
            const word = snapshot.guests.data[row * 4 + 3]!;
            if (word >>> 24 !== 6) continue;
            const id: number = snapshot.guestIds[row]!;
            const seated = (word & (1 << 11)) !== 0;
            const x: number = snapshot.guests.data[row * 4]!;
            const y: number = snapshot.guests.data[row * 4 + 1]!;
            const heading = (word >>> 16) & 0xff;
            const entry = (log.sessions[id] ??= {
              heading,
              start: tick,
              seatedAt: -1,
              end: -1,
              x,
              y,
            });
            if (entry.seatedAt < 0) entry.heading = heading;
            entry.x = x;
            entry.y = y;
            if (seated && entry.seatedAt < 0) entry.seatedAt = tick;
            now.push(seated ? id : -id);
          }
          for (const key of Object.keys(log.sessions)) {
            const entry = log.sessions[key]!;
            const id = Number(key);
            if (entry.end < 0 && !now.includes(id) && !now.includes(-id)) entry.end = tick;
          }
          log.sittingNow = now;
        });
      }
    } as typeof Worker;
  });
}

async function readLog(page: Page): Promise<BenchLog> {
  return page.evaluate(() => (window as unknown as { __benchLog: BenchLog }).__benchLog);
}

async function setSpeed(page: Page, speed: 1 | 2 | 4): Promise<void> {
  await page
    .locator('.game-toolbar')
    .getByRole('button', { name: `Game speed ${speed}×` })
    .click();
}

async function cameraRotation(page: Page): Promise<Rotation> {
  return page.evaluate(
    () => (window as unknown as { __camera: { rotation: Rotation } }).__camera.rotation,
  );
}

/** Centres the camera on a world position (guest units) at the given zoom. */
async function focusPoint(
  page: Page,
  world: World,
  at: { x: number; y: number },
  zoom: number,
): Promise<void> {
  const tile = world.map.index(at.x >> 8, at.y >> 8);
  const out = new Float64Array(2);
  project(
    at.x,
    at.y,
    world.map.heights[tile]! * Z_STEP + PATH_SURFACE_Z + 12,
    world.map.width,
    world.map.height,
    await cameraRotation(page),
    out,
  );
  await page.evaluate(
    ({ x, y, zoom }) => {
      const camera = (window as unknown as { __camera: { x: number; y: number; zoom: number } })
        .__camera;
      camera.x = x;
      camera.y = y;
      camera.zoom = zoom;
    },
    { x: out[0]!, y: out[1]!, zoom },
  );
}

async function rotateTo(page: Page, target: Rotation): Promise<void> {
  const rotate = page.locator('.game-toolbar').getByRole('button', {
    name: 'Rotate right',
    exact: true,
  });
  for (let i = 0; i < 4 && (await cameraRotation(page)) !== target; i++) await rotate.click();
  await expect.poll(() => cameraRotation(page)).toBe(target);
}

/** A screenshot of the area around the middle of the game view, enlarged with nearest-neighbour. */
async function clipShot(page: Page, path: string): Promise<void> {
  const game = await page.locator('#game').boundingBox();
  if (!game) throw new Error('Game viewport is missing');
  const png = await page.screenshot({
    clip: {
      x: game.x + game.width / 2 - CLIP.width / 2,
      y: game.y + game.height / 2 - CLIP.height / 2,
      width: CLIP.width,
      height: CLIP.height,
    },
  });
  await sharp(png)
    .resize({ width: CLIP.width * CLIP.scale, kernel: 'nearest' })
    .toFile(path);
}

function distanceToRides(world: World, x: number, y: number): number {
  let best = Infinity;
  for (let slot = 0; slot < world.rides.count; slot++)
    best = Math.min(
      best,
      Math.max(
        Math.abs(world.rides.cols.entranceX[slot]! - x),
        Math.abs(world.rides.cols.entranceY[slot]! - y),
      ),
    );
  return best;
}

for (const renderer of ['canvas2d', 'webgl2'] as const) {
  test(`guests naturally sit on player-placed benches (${renderer})`, async ({ page }) => {
    test.skip(!proofDir, 'set BENCH_PROOF_DIR to run the bench-use proof');
    test.setTimeout(MAX_WALL_MS + 600_000);
    const out = join(proofDir!, renderer);
    await mkdir(out, { recursive: true });
    if (renderer === 'canvas2d') {
      await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
          if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
          return original.call(this, type as '2d', ...(args as []));
        } as typeof HTMLCanvasElement.prototype.getContext;
      });
    }
    page.on('crash', () => console.log('PAGE CRASH'));
    await watchSnapshots(page);
    await page.setViewportSize({ width: 960, height: 600 });

    const bytes = parkBytes(renderer === 'canvas2d');
    const fixture = deserialize(bytes);
    await startStarterPark(page);
    await expect(page.locator('.hud')).toContainText(
      renderer === 'canvas2d' ? 'Canvas2D' : 'WebGL2',
    );
    await importWorld(page, bytes);

    const candidates = benchCandidates(fixture);
    const step = Math.max(1, Math.floor(candidates.length / BENCHES));
    const chosen = candidates.filter((_, i) => i % step === 0).slice(0, BENCHES);
    const middle = chosen[Math.floor(chosen.length / 2)]!;
    await focusPoint(
      page,
      fixture,
      { x: middle.x * TILE_UNITS + 128, y: middle.y * TILE_UNITS + 128 },
      renderer === 'canvas2d' ? 1.5 : 3,
    );

    await toolbarAction(page, 'Scenery');
    const scenery = page.locator('.ui-window[data-panel="scenery"]');
    await expect(scenery).toBeVisible();
    await scenery.getByRole('tab', { name: 'Benches', exact: true }).click();
    for (const tile of chosen) {
      await focusPoint(
        page,
        fixture,
        { x: tile.x * TILE_UNITS + 128, y: tile.y * TILE_UNITS + 128 },
        renderer === 'canvas2d' ? 1.5 : 3,
      );
      const [x, y] = await tileScreenPoint(page, fixture, tile);
      await page.mouse.click(x, y);
    }
    await focusPoint(
      page,
      fixture,
      { x: middle.x * TILE_UNITS + 128, y: middle.y * TILE_UNITS + 128 },
      renderer === 'canvas2d' ? 1.5 : 3,
    );
    await page.locator('.ui-window button[aria-label^="Close"]').first().click();
    await page.screenshot({ path: join(out, '01-benches-placed.png') });

    const placed = await savedWorld(page);
    const placedBenches = chosen.filter((tile) => {
      const e = placed.map.pathElement(placed.map.index(tile.x, tile.y), -1);
      return e >= 0 && (placed.map.elFlags[e]! & PathFlag.Bench) !== 0;
    });
    expect(placedBenches.length).toBeGreaterThan(0);
    const placedTick = (await readLog(page)).lastTick;

    await setSpeed(page, 4);
    const started = Date.now();
    let log = await readLog(page);
    while (log.lastTick - placedTick < RUN_TICKS && Date.now() - started < MAX_WALL_MS) {
      await page.waitForTimeout(3000);
      log = await readLog(page);
    }
    await page.screenshot({ path: join(out, '02-running.png') });

    // Follow one guest from its walk to the seat until it rises: a frame sequence. The walk to the
    // seat takes about a second, so the game is paused the moment it is seen to frame the shot.
    await setSpeed(page, 1);
    let followed = 0;
    for (let waited = 0; waited < 300_000 && followed === 0; waited += 100) {
      await page.waitForTimeout(100);
      const current = await readLog(page);
      followed =
        current.sittingNow.find((id) => id < 0 && current.sessions[-id]?.seatedAt === -1) ?? 0;
    }
    const toolbar = page.locator('.game-toolbar');
    await toolbar.getByRole('button', { name: 'Pause', exact: true }).click();
    const frames = join(out, 'sequence');
    await mkdir(frames, { recursive: true });
    let frame = 0;
    let follow = Math.abs(followed);
    const approach = (await readLog(page)).sessions[follow];
    if (approach) await rotateTo(page, ((4 - ((approach.heading + 2) & 3)) & 3) as Rotation);
    let phase: 'approach' | 'seated' | 'rising' = 'approach';
    for (let i = 0; i < 400 && follow !== 0; i++) {
      const current = await readLog(page);
      const state = current.sessions[follow];
      if (state) {
        if (phase === 'approach' && state.seatedAt >= 0) {
          phase = 'seated';
          await setSpeed(page, 4);
        } else if (phase === 'seated' && current.sittingNow.includes(-follow)) {
          phase = 'rising';
          await setSpeed(page, 1);
        }
        await focusPoint(page, fixture, { x: state.x, y: state.y }, 4);
        await clipShot(page, join(frames, `${String(frame++).padStart(3, '0')}.png`));
        if (i === 0) await toolbar.getByRole('button', { name: 'Resume', exact: true }).click();
        if (state.end >= 0) follow = 0;
      }
      await page.waitForTimeout(100);
    }
    await setSpeed(page, 1);

    // Wait for someone seated to take the close-ups.
    let seated: number[] = [];
    for (let waited = 0; waited < 300_000 && seated.length === 0; waited += 200) {
      await page.waitForTimeout(200);
      seated = (await readLog(page)).sittingNow.filter((id) => id > 0);
    }
    expect(seated.length).toBeGreaterThan(0);
    await page.locator('.game-toolbar').getByRole('button', { name: 'Pause', exact: true }).click();
    log = await readLog(page);
    const paused = await savedWorld(page);
    const sitters: Array<{
      id: number;
      tile: { x: number; y: number };
      heading: number;
      seat: number;
    }> = [];
    for (let slot = 0; slot < paused.guests.count; slot++) {
      if (!isSeated(paused, slot)) continue;
      sitters.push({
        id: paused.guests.slotToId[slot]!,
        tile: { x: paused.guests.cols.x[slot]! >> 8, y: paused.guests.cols.y[slot]! >> 8 },
        heading: paused.guests.cols.heading[slot]!,
        seat: paused.guests.cols.seat[slot]!,
      });
    }
    expect(sitters.length).toBeGreaterThan(0);
    sitters.sort(
      (a, b) =>
        distanceToRides(paused, b.tile.x, b.tile.y) - distanceToRides(paused, a.tile.x, a.tile.y),
    );
    const target = sitters[0]!;
    const slot = paused.guests.idToSlot[target.id]!;
    const seatAt = { x: paused.guests.cols.x[slot]!, y: paused.guests.cols.y[slot]! };
    for (const rotation of [0, 1, 2, 3] as const) {
      await rotateTo(page, rotation);
      await focusPoint(page, paused, seatAt, 4);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(out, `03-view-rot${rotation}.png`) });
      await clipShot(page, join(out, `04-seat-rot${rotation}.png`));
    }

    const sessions = Object.values(log.sessions).filter((s) => s.seatedAt >= 0);
    const done = sessions.filter((s) => s.end >= 0);
    const report = {
      renderer,
      fixture:
        renderer === 'canvas2d'
          ? 'balance park seed 1, sensible profile (four flat rides, stalls, toilets, three staff), 2 months in'
          : 'balance park seed 1, sensible profile with the flat rides demolished (stalls and toilets only), 2 months in',
      benchesRequested: chosen.length,
      benchesPlacedThroughUi: placedBenches.length,
      tickWhenPlaced: placedTick,
      tickWhenPaused: log.lastTick,
      elapsedSimTicks: log.lastTick - placedTick,
      elapsedSimMinutes: Number(((log.lastTick - placedTick) / 40 / 60).toFixed(1)),
      guestsInParkWhenPaused: paused.guests.count,
      sittingSessionsObserved: sessions.length,
      completedSessions: done.length,
      distinctSitters: new Set(Object.keys(log.sessions)).size,
      meanSecondsSeated: Number(
        (
          done.reduce((sum, s) => sum + (s.end - s.seatedAt), 0) /
          Math.max(1, done.length) /
          40
        ).toFixed(1),
      ),
      sequenceFrames: frame,
      closeUpGuest: target,
      seatedWhenPaused: sitters,
      wallSeconds: Math.round((Date.now() - started) / 1000),
    };
    await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
    expect(sessions.length).toBeGreaterThan(0);
  });
}

/**
 * Controlled pose check, not a gameplay proof: a plus-shaped path with a bench on each arm and
 * tired guests standing on them, so every seat orientation shows in every camera rotation.
 */
function poseFixture(): Uint8Array {
  const world = flatWorld(24, 7, 64);
  layPath(world, row(10, 6, 14));
  layPath(
    world,
    Array.from({ length: 9 }, (_, i) => [10, 6 + i] as [number, number]).filter(
      ([, y]) => y !== 10,
    ),
  );
  for (const [x, y] of [
    [8, 10],
    [12, 10],
    [10, 8],
    [10, 12],
  ] as const) {
    setPathAddition(world.map, x, y, PathAddition.Bench);
    for (let i = 0; i < 3; i++) {
      const guest = guestAt(world, x, y);
      world.guests.cols.energy[guest] = 60 + i;
      world.guests.cols.tint[guest] = (x + y + i * 3) % 8;
      world.guests.cols.happiness[guest] = 200;
      world.guests.cols.happinessTarget[guest] = 200;
    }
  }
  return serialize(world);
}

for (const renderer of ['canvas2d', 'webgl2'] as const) {
  test(`seated guests line up with the bench in every rotation (${renderer})`, async ({ page }) => {
    test.skip(!proofDir, 'set BENCH_PROOF_DIR to run the seated pose captures');
    test.setTimeout(600_000);
    const out = join(proofDir!, `pose-${renderer}`);
    await mkdir(out, { recursive: true });
    if (renderer === 'canvas2d') {
      await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
          if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
          return original.call(this, type as '2d', ...(args as []));
        } as typeof HTMLCanvasElement.prototype.getContext;
      });
    }
    await watchSnapshots(page);
    await page.setViewportSize({ width: 960, height: 600 });
    const bytes = poseFixture();
    const fixture = deserialize(bytes);
    await startStarterPark(page);
    await importWorld(page, bytes);
    await setSpeed(page, 1);
    let seated: number[] = [];
    for (let waited = 0; waited < 120_000 && seated.length < 8; waited += 200) {
      await page.waitForTimeout(200);
      seated = (await readLog(page)).sittingNow.filter((id) => id > 0);
    }
    await page.locator('.game-toolbar').getByRole('button', { name: 'Pause', exact: true }).click();
    expect(seated.length).toBeGreaterThanOrEqual(8);
    const centre = { x: 10 * TILE_UNITS + 128, y: 10 * TILE_UNITS + 128 };
    for (const rotation of [0, 1, 2, 3] as const) {
      await rotateTo(page, rotation);
      await focusPoint(page, fixture, centre, 3);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(out, `pose-rot${rotation}.png`) });
    }
  });
}
