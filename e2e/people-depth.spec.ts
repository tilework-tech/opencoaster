import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { OBJECT_KINDS } from '../src/render/object-kinds';

/**
 * People against footpaths, ramps, queues, raised ground, benches, trees and stalls, scored against the
 * occlusion oracle (src/render/occlusion-oracle.ts). Each case renders the dev fixture page
 * (`/depth-fixture.html`) with a guest at a sub-tile position and compares the renderer's
 * object-ID image with the oracle's z-buffer over the same placed sprites and terrain: every
 * pixel of the frame, not only the guest's, must show the object the meshes put there. The
 * Canvas2D composite uses the oracle's own rule, so the two renderers' object kinds are also
 * compared pixel for pixel.
 */

type Renderer = 'webgl2' | 'canvas2d';
type Rotation = 0 | 1 | 2 | 3;
type At = [number, number, number];

const SIZE = { width: 320, height: 240 };
const ROTATIONS: Rotation[] = [0, 1, 2, 3];
/** Share of object pixels allowed to differ from the oracle (sampling at sprite edges). */
const MAX_MISMATCH = 0.005;
/** Pixels of a guest that may disagree with the oracle (beyond the ambiguous edge samples). */
const MAX_GUEST_MISMATCH = 8;
/** Share of pixels showing objects in both renderers whose kinds may differ between them. */
const MAX_KIND_DISAGREEMENT = 0.01;

interface Score {
  objectPixels: number;
  mismatched: number;
  pairs: Record<string, { mismatched: number; contested: number }>;
}

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

  /** Places the guest, centres the camera on it and scores the frame against the oracle. */
  async score(guest: At): Promise<{ score: Score; kinds: string }> {
    return this.page.evaluate((at) => {
      const w = window as unknown as {
        __show(a: At, b: At): void;
        __score(): Score;
        __kinds(): string;
      };
      w.__show(at, at);
      return { score: w.__score(), kinds: w.__kinds() };
    }, guest);
  }

  close(): Promise<void> {
    return this.page.close();
  }
}

/** Code of the ground kind in the fixture's kind strings (`A` + its index in OBJECT_KINDS). */
const GROUND_CODE = 'A'.charCodeAt(0) + OBJECT_KINDS.indexOf('ground');
const NOTHING_CODE = '@'.charCodeAt(0);

/**
 * Pixels where both renderers show an object (not ground), and how many of those show different
 * kinds: which object wins a pixel, independent of sub-pixel sprite placement at the edges.
 */
function kindDisagreement(a: string, b: string): { objects: number; differing: number } {
  let objects = 0;
  let differing = 0;
  const ground = (code: number) => code === GROUND_CODE || code === NOTHING_CODE;
  for (let i = 0; i < a.length; i++) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(i);
    if (ground(ca) || ground(cb)) continue;
    objects++;
    if (ca !== cb) differing++;
  }
  return { objects, differing };
}

const CASES: Array<{ name: string; scene: string; at: At[] }> = [
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
    name: 'raised path, on the deck and under it',
    scene: 'path-raised',
    at: [
      [6.1, 8.2, 4],
      [8.8, 8.8, 4],
      [8.5, 8.5, 2],
      [7.3, 8.6, 2],
    ],
  },
  {
    name: 'queue',
    scene: 'path-queue',
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
  {
    name: 'hill, with guests behind, beside and in front of raised ground',
    scene: 'hill',
    at: [
      [6.5, 6.5, 2],
      [6.8, 8.5, 2],
      [8.5, 6.8, 2],
      [10.3, 10.3, 2],
      [6.5, 10.5, 2],
      [10.5, 6.5, 2],
    ],
  },
  ...(['tree', 'stall', 'bench'] as const).map((scene) => {
    const [ox, oy] = scene === 'bench' ? [8.5, 8.9] : [8.5, 7.5];
    // Guests in front of, behind and beside the object at sub-tile offsets.
    const offsets = [-1.1, -0.7, -0.3, 0.3, 0.7, 1.1];
    return {
      name: `${scene} with guests around it`,
      scene,
      at: offsets.flatMap((d): At[] => [
        [ox + d * 0.7071, oy + d * 0.7071, 2],
        [ox + d * 0.7071, oy - d * 0.7071, 2],
      ]),
    };
  }),
];

for (const rotation of ROTATIONS) {
  test.describe(`rotation ${rotation}`, () => {
    test.describe.configure({ timeout: 240_000 });
    for (const item of CASES) {
      test(`people and the ${item.name} match the occlusion oracle`, async ({ page }) => {
        const context = page.context();
        const webgl = await Fixture.open(context, 'webgl2', rotation, item.scene);
        const canvas = await Fixture.open(context, 'canvas2d', rotation, item.scene);
        for (const guest of item.at) {
          const gl = await webgl.score(guest);
          const c2d = await canvas.score(guest);
          for (const [renderer, { score }] of [
            ['webgl2', gl],
            ['canvas2d', c2d],
          ] as const) {
            expect(
              score.mismatched / Math.max(1, score.objectPixels),
              `${renderer} guest at ${guest}: ${JSON.stringify(score.pairs)}`,
            ).toBeLessThanOrEqual(MAX_MISMATCH);
            const guestMismatch = Object.entries(score.pairs)
              .filter(([pair]) => pair.split('>').includes('guest'))
              .reduce((sum, [, pair]) => sum + pair.mismatched, 0);
            expect(
              guestMismatch,
              `${renderer} guest at ${guest} pixels: ${JSON.stringify(score.pairs)}`,
            ).toBeLessThanOrEqual(MAX_GUEST_MISMATCH);
          }
          const parity = kindDisagreement(gl.kinds, c2d.kinds);
          expect(
            parity.differing / Math.max(1, parity.objects),
            `webgl2 and canvas2d object kinds, guest at ${guest}`,
          ).toBeLessThanOrEqual(MAX_KIND_DISAGREEMENT);
        }
        await webgl.close();
        await canvas.close();
      });
    }
  });
}
