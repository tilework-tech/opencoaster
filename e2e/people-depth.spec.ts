import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import sharp from 'sharp';

/**
 * Pixel ownership of people against footpaths, ramps, benches, trees and stalls. Each case renders
 * the dev fixture page (`/depth-fixture.html`) four times with the same camera:
 *   full   - the scene with a guest
 *   scene  - the scene alone
 *   alone  - a bare map with the guest
 *   bare   - a bare map
 * The guest's pixels are where `alone` differs from `bare`. Where the scene covers a guest pixel
 * the guest is behind; where it does not, the guest must own the pixel.
 */

type Renderer = 'webgl2' | 'canvas2d';
type Rotation = 0 | 1 | 2 | 3;

interface Shot {
  data: Buffer;
}

const SIZE = { width: 320, height: 240 };
const RENDERERS: Renderer[] = ['webgl2', 'canvas2d'];
const ROTATIONS: Rotation[] = [0, 1, 2, 3];
const MAP = 16;

/** One loaded fixture page: a scene at a rotation, redrawn with the guest and camera moved. */
class Fixture {
  private constructor(private readonly page: Page) {}

  static async open(
    context: BrowserContext,
    renderer: Renderer,
    rotation: Rotation,
    scene: string,
  ): Promise<Fixture> {
    const page = await context.newPage();
    const query = new URLSearchParams({
      renderer,
      rot: String(rotation),
      scene,
      zoom: '4',
      w: String(SIZE.width),
      h: String(SIZE.height),
    });
    await page.goto(`/depth-fixture.html?${query}`);
    await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);
    return new Fixture(page);
  }

  /** Draws with the guest at `guest` (or absent) and the camera centred on `look`. */
  async shot(
    guest: [number, number, number] | null,
    look: [number, number, number],
  ): Promise<Shot> {
    await this.page.evaluate(
      ([at, view]) =>
        (window as unknown as { __show: (a: unknown, b: unknown) => void }).__show(at, view),
      [guest, look] as const,
    );
    let previous: Buffer | null = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      const current = await this.page.screenshot({ clip: { x: 0, y: 0, ...SIZE } });
      if (previous?.equals(current)) break;
      previous = current;
      await this.page.waitForTimeout(80);
    }
    const { data } = await sharp(previous!)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { data };
  }
}

function differs(a: Buffer, b: Buffer, pixel: number, tolerance: number): boolean {
  const o = pixel * 3;
  return (
    Math.abs(a[o]! - b[o]!) + Math.abs(a[o + 1]! - b[o + 1]!) + Math.abs(a[o + 2]! - b[o + 2]!) >
    tolerance
  );
}

interface Ownership {
  /** Guest pixels the scene paints over. */
  covered: number;
  /** Guest pixels that are not painted over and show the guest. */
  shown: number;
  /** Guest pixels the scene paints over but that show the guest anyway. */
  coveredButShown: number;
  /** Guest pixels outside the scene's footprint that the guest lost. */
  uncoveredButLost: number;
}

function measure(full: Shot, scene: Shot, base: Shot, alone: Shot, bare: Shot): Ownership {
  const pixels = SIZE.width * SIZE.height;
  const result: Ownership = { covered: 0, shown: 0, coveredButShown: 0, uncoveredButLost: 0 };
  for (let pixel = 0; pixel < pixels; pixel++) {
    if (!differs(alone.data, bare.data, pixel, 120)) continue;
    const sceneCovers = differs(scene.data, base.data, pixel, 30);
    // Where guest and scene look alike, who owns the pixel cannot be told.
    const distinct = differs(alone.data, scene.data, pixel, 90);
    const showsGuest = !differs(full.data, alone.data, pixel, 40);
    const showsScene = !differs(full.data, scene.data, pixel, 40);
    if (distinct && sceneCovers && showsScene && !showsGuest) result.covered++;
    else if (distinct && showsGuest && sceneCovers) result.coveredButShown++;
    if (showsGuest) result.shown++;
    if (!sceneCovers && !showsGuest) result.uncoveredButLost++;
  }
  return result;
}

/** Sum along the view axis: larger is nearer the camera. */
function viewSum(x: number, y: number, rotation: Rotation): number {
  switch (rotation) {
    case 0:
      return x + y;
    case 1:
      return MAP - y + x;
    case 2:
      return MAP - x + MAP - y;
    case 3:
      return y + MAP - x;
  }
}

/**
 * Ownership of a guest against `sceneName`. `ground` names the same scene without the object under
 * test, so only the object's own pixels count as covering the guest.
 */
async function ownership(
  page: Page,
  renderer: Renderer,
  rotation: Rotation,
  sceneName: string,
  ground: string,
  guests: Array<[number, number, number]>,
): Promise<Ownership[]> {
  const context = page.context();
  const scene = await Fixture.open(context, renderer, rotation, sceneName);
  const base =
    ground === sceneName ? scene : await Fixture.open(context, renderer, rotation, ground);
  const blank = await Fixture.open(context, renderer, rotation, 'blank');
  const results: Ownership[] = [];
  for (const guest of guests) {
    const full = await scene.shot(guest, guest);
    const without = await scene.shot(null, guest);
    const objects = await base.shot(null, guest);
    const alone = await blank.shot(guest, guest);
    const bare = await blank.shot(null, guest);
    results.push(measure(full, without, objects, alone, bare));
  }
  return results;
}

/** A guest standing on a path surface is never hidden by that surface or by terrain. */
const SURFACE_CASES: Array<{
  name: string;
  scene: string;
  at: Array<[number, number, number]>;
  /** Share of the guest that props such as queue ropes may legitimately cross. */
  allowance?: number;
}> = [
  {
    name: 'flat path, back half and front half of a tile',
    scene: 'path-flat',
    at: [
      [8.1, 8.1, 2],
      [8.9, 8.9, 2],
      [8.02, 8.5, 2],
      [7.98, 8.5, 2],
    ],
  },
  {
    name: 'raised path',
    scene: 'path-raised',
    at: [
      [6.1, 8.2, 4],
      [8.8, 8.8, 4],
    ],
  },
  {
    name: 'queue',
    scene: 'path-queue',
    allowance: 0.12,
    at: [
      [8.5, 8.5, 2],
      [7.5, 8.5, 2],
    ],
  },
  {
    name: 'ramp rising along x with a raised piece ahead',
    scene: 'path-slope',
    at: [
      [5.4, 8.5, 2],
      [6.2, 8.5, 2.2],
      [6.9, 8.5, 2.9],
      [7.5, 8.5, 3.5],
      [7.95, 8.5, 3.95],
    ],
  },
  {
    name: 'ramp rising along y',
    scene: 'path-slope-y',
    at: [
      [8.5, 5.4, 2],
      [8.5, 6.5, 2.5],
      [8.5, 7.9, 3.9],
    ],
  },
];

for (const renderer of RENDERERS) {
  for (const rotation of ROTATIONS) {
    test.describe(`${renderer} rotation ${rotation}`, () => {
      test.describe.configure({ timeout: 120_000 });

      for (const item of SURFACE_CASES) {
        test(`guest stays on top of the ${item.name}`, async ({ page }) => {
          const results = await ownership(page, renderer, rotation, item.scene, 'blank', item.at);
          results.forEach((result, index) => {
            const guest = item.at[index]!;
            expect(result.shown, `guest at ${guest}`).toBeGreaterThan(30);
            expect(result.covered, `guest at ${guest} hidden by the surface`).toBeLessThanOrEqual(
              Math.ceil(result.shown * (item.allowance ?? 0.02)),
            );
            expect(result.uncoveredButLost, `guest at ${guest} lost pixels`).toBeLessThanOrEqual(
              Math.ceil(result.shown * 0.02),
            );
          });
        });
      }

      for (const object of ['tree', 'stall', 'bench'] as const) {
        test(`guest and ${object} order by distance from the camera`, async ({ page }) => {
          const objectAt: [number, number] = object === 'bench' ? [8.5, 8.9] : [8.5, 7.5];
          const lane = lateral(rotation);
          const spots: Array<{ guest: [number, number, number]; front: boolean }> = [];
          for (const distance of [0.7, 1.1]) {
            spots.push({
              guest: [objectAt[0] + lane[0] * distance, objectAt[1] + lane[1] * distance, 2],
              front: true,
            });
            spots.push({
              guest: [objectAt[0] - lane[0] * distance, objectAt[1] - lane[1] * distance, 2],
              front: false,
            });
          }
          const results = await ownership(
            page,
            renderer,
            rotation,
            object,
            'path-flat',
            spots.map((spot) => spot.guest),
          );
          let overlapped = 0;
          results.forEach((result, index) => {
            const spot = spots[index]!;
            const [gx, gy] = spot.guest;
            const nearer = viewSum(gx, gy, rotation) > viewSum(objectAt[0], objectAt[1], rotation);
            expect(nearer, 'fixture geometry').toBe(spot.front);
            if (spot.front) {
              expect(result.covered, `guest in front at ${spot.guest}`).toBeLessThanOrEqual(
                Math.ceil(result.shown * 0.02),
              );
            } else if (result.covered + result.coveredButShown >= 12) {
              overlapped++;
              expect(
                result.coveredButShown,
                `guest behind at ${spot.guest} shows through`,
              ).toBeLessThanOrEqual(
                Math.max(6, Math.ceil((result.covered + result.coveredButShown) * 0.05)),
              );
            }
          });
          if (object !== 'bench')
            expect(overlapped, 'the guest overlaps the object when behind').toBeGreaterThan(0);
        });
      }
    });
  }
}

/** World-axis step that moves a point toward the camera along the screen's vertical line. */
function lateral(rotation: Rotation): [number, number] {
  switch (rotation) {
    case 0:
      return [0.7071, 0.7071];
    case 1:
      return [0.7071, -0.7071];
    case 2:
      return [-0.7071, -0.7071];
    case 3:
      return [-0.7071, 0.7071];
  }
}
