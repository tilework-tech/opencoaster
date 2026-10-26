import type { BrowserContext, Page } from '@playwright/test';
import sharp from 'sharp';

/**
 * Pixel ownership of a person against the scene drawn around them. Each case renders
 * the dev fixture page (`/depth-fixture.html`) four times with the same camera:
 *   full   - the scene with a guest
 *   scene  - the scene alone
 *   alone  - a bare map with the guest
 *   bare   - a bare map
 * The guest's pixels are where `alone` differs from `bare`. Where the scene covers a guest pixel
 * the guest is behind; where it does not, the guest must own the pixel.
 */

export type Renderer = 'webgl2' | 'canvas2d';
export type Rotation = 0 | 1 | 2 | 3;

export interface Shot {
  data: Buffer;
}

export const SIZE = { width: 320, height: 240 };
export const RENDERERS: Renderer[] = ['webgl2', 'canvas2d'];
export const ROTATIONS: Rotation[] = [0, 1, 2, 3];
export const MAP = 16;

/** One loaded fixture page: a scene at a rotation, redrawn with the guest and camera moved. */
export class Fixture {
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

export interface Ownership {
  /** Guest pixels the scene paints over. */
  covered: number;
  /** Guest pixels that are not painted over and show the guest. */
  shown: number;
  /** Guest pixels the scene paints over but that show the guest anyway. */
  coveredButShown: number;
  /** Guest pixels outside the scene's footprint that the guest lost. */
  uncoveredButLost: number;
}

export function measure(full: Shot, scene: Shot, base: Shot, alone: Shot, bare: Shot): Ownership {
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
export function viewSum(x: number, y: number, rotation: Rotation): number {
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
export async function ownership(
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

/** World-axis step that moves a point toward the camera along the screen's vertical line. */
export function lateral(rotation: Rotation): [number, number] {
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
