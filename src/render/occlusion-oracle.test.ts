import { describe, expect, it } from 'vitest';
import { box, material, translateMesh } from '../../tools/sprites/mesh';
import type { Mesh } from '../../tools/sprites/mesh';
import { ramp } from '../../tools/sprites/palette';
import { project as projectModel, renderMesh, TRANSPARENT } from '../../tools/sprites/raster';
import type { Sprite } from '../../tools/sprites/raster';
import { encodeHeight } from './height-encoding';
import { compositeScene, NO_OBJECT } from './occlusion-oracle';
import type { OraclePage, OracleSprite } from './occlusion-oracle';

/** One-sprite atlas page holding `sprite`'s colour coverage and encoded heights. */
function pageOf(sprite: Sprite): OraclePage {
  const colour = new Uint8ClampedArray(sprite.width * sprite.height * 4);
  const heights = new Uint8ClampedArray(sprite.width * sprite.height * 4);
  for (let i = 0; i < sprite.pixels.length; i++) {
    if (sprite.pixels[i] === TRANSPARENT) continue;
    colour[i * 4 + 3] = 255;
    const [hi, lo] = encodeHeight(sprite.heights![i]);
    heights[i * 4] = hi;
    heights[i * 4 + 1] = lo;
    heights[i * 4 + 3] = 255;
  }
  return { width: sprite.width, height: sprite.height, colour, heights };
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const VIEW = 256;
const ORIGIN = { x: 128, y: 160 };

describe('occlusion oracle', () => {
  it('composites mesh-baked sprites exactly as one z-buffer over the placed meshes', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const random = seeded(seed);
      const parts: { mesh: Mesh; at: [number, number, number] }[] = [];
      for (let i = 0; i < 6; i++) {
        const w = 0.1 + random() * 0.5;
        const d = 0.1 + random() * 0.5;
        const h = 0.2 + random() * 3;
        // Offsets on a 1/16-tile and 1/16-level grid project to whole pixels.
        const at: [number, number, number] = [
          Math.round((random() * 3 - 1.5) * 16) / 16,
          Math.round((random() * 3 - 1.5) * 16) / 16,
          Math.round(random() * 2 * 16) / 16,
        ];
        parts.push({ mesh: box([-w, -d, 0], [w, d, h], material(ramp('asphalt'))), at });
      }
      // Ground truth: every part rasterised together through one z-buffer, tagged by part.
      const joint = renderMesh(
        parts.flatMap(({ mesh, at }, index) =>
          translateMesh(mesh, ...at).map((t) => ({
            ...t,
            material: { ...t.material, shader: () => index },
          })),
        ),
        { outline: false },
      );
      const sprites: OracleSprite[] = [];
      const pages: OraclePage[] = [];
      parts.forEach(({ mesh, at }, index) => {
        const sprite = renderMesh(mesh, { outline: false });
        pages.push(pageOf(sprite));
        const [sx, sy] = projectModel(at[0], at[1], at[2]);
        sprites.push({
          id: index + 1,
          page: index,
          frame: { x: 0, y: 0, width: sprite.width, height: sprite.height },
          left: ORIGIN.x + sx - sprite.anchor.x,
          top: ORIGIN.y + sy - sprite.anchor.y,
          width: sprite.width,
          height: sprite.height,
          anchorHeight: at[2],
          heightScale: 1,
        });
      });
      const result = compositeScene({ width: VIEW, height: VIEW, pages, sprites, triangles: [] });

      let compared = 0;
      let wrong = 0;
      for (let y = 0; y < joint.height; y++)
        for (let x = 0; x < joint.width; x++) {
          const truth = joint.pixels[y * joint.width + x];
          const px = ORIGIN.x + x - joint.anchor.x;
          const py = ORIGIN.y + y - joint.anchor.y;
          const got = result.ids[py * VIEW + px];
          if (truth === TRANSPARENT) {
            expect(got).toBe(NO_OBJECT);
            continue;
          }
          compared++;
          if (got !== truth + 1) wrong++;
        }
      expect(compared).toBeGreaterThan(500);
      expect(wrong / compared).toBeLessThan(0.002);
    }
  });

  it('lets a raised terrain triangle hide the part of a sprite standing behind it', () => {
    const person = renderMesh(box([-0.1, -0.1, 0], [0.1, 0.1, 1.5], material(ramp('asphalt'))), {
      outline: false,
    });
    // A person at tile (0, 0) height 0, and the ground of the tile in front, (1, 1), raised 2 levels.
    const [sx, sy] = projectModel(0, 0, 0);
    const corner = (x: number, y: number, z: number) => {
      const [cx, cy] = projectModel(x, y, z);
      return { x: ORIGIN.x + cx, y: ORIGIN.y + cy, height: z };
    };
    const result = compositeScene({
      width: VIEW,
      height: VIEW,
      pages: [pageOf(person)],
      sprites: [
        {
          id: 1,
          page: 0,
          frame: { x: 0, y: 0, width: person.width, height: person.height },
          left: ORIGIN.x + sx - person.anchor.x,
          top: ORIGIN.y + sy - person.anchor.y,
          width: person.width,
          height: person.height,
          anchorHeight: 0,
          heightScale: 1,
        },
      ],
      triangles: [
        { id: 2, a: corner(0.5, 0.5, 2), b: corner(1.5, 0.5, 2), c: corner(1.5, 1.5, 2) },
        { id: 2, a: corner(0.5, 0.5, 2), b: corner(1.5, 1.5, 2), c: corner(0.5, 1.5, 2) },
      ],
    });
    // The person's head (1.4 levels up) shows above the raised tile; their feet are hidden.
    const head = projectModel(0, 0, 1.4);
    const feet = projectModel(0, 0, 0.1);
    expect(
      result.ids[(ORIGIN.y + Math.floor(head[1])) * VIEW + ORIGIN.x + Math.floor(head[0])],
    ).toBe(1);
    expect(
      result.ids[(ORIGIN.y + Math.floor(feet[1])) * VIEW + ORIGIN.x + Math.floor(feet[0])],
    ).toBe(2);
  });
});

describe('sprite coverage at pixel centres', () => {
  it('follows the GPU fill rule: a centre on the top edge is outside, on the bottom edge inside', () => {
    const page: OraclePage = {
      width: 1,
      height: 2,
      colour: new Uint8ClampedArray([9, 9, 9, 255, 9, 9, 9, 255]),
      heights: new Uint8ClampedArray([128, 0, 0, 255, 128, 0, 0, 255]),
    };
    const sprite: OracleSprite = {
      id: 1,
      page: 0,
      frame: { x: 0, y: 0, width: 1, height: 2 },
      left: 0,
      top: 0.5,
      width: 1,
      height: 2,
      anchorHeight: 0,
      heightScale: 1,
    };
    const { ids } = compositeScene({
      width: 1,
      height: 3,
      pages: [page],
      sprites: [sprite],
      triangles: [],
    });
    // Rows centred at 0.5 (top edge), 1.5 (inside) and 2.5 (bottom edge).
    expect([...ids]).toEqual([NO_OBJECT, 1, 1]);
  });
});

describe('ambiguous samples', () => {
  it('marks pixels whose sample sits on a texel boundary between covered and clear texels', () => {
    // Two texels: clear then covered, drawn 4 px wide from x = 0.5. Pixel centres sample texel
    // coordinates 0.5, 0.75, 1.0 and 1.25 (half-texel inset), so pixel 2 sits on the boundary.
    const page: OraclePage = {
      width: 2,
      height: 1,
      colour: new Uint8ClampedArray([0, 0, 0, 0, 9, 9, 9, 255]),
      heights: new Uint8ClampedArray([0, 0, 0, 0, 128, 0, 0, 255]),
    };
    const sprite: OracleSprite = {
      id: 1,
      page: 0,
      frame: { x: 0, y: 0, width: 2, height: 1 },
      left: 0.5,
      top: 0,
      width: 4,
      height: 1,
      anchorHeight: 0,
      heightScale: 1,
    };
    const { ambiguous } = compositeScene({
      width: 4,
      height: 1,
      pages: [page],
      sprites: [sprite],
      triangles: [],
    });
    expect([...ambiguous]).toEqual([0, 0, 1, 0]);
  });
});

describe('height ties', () => {
  it('lets the later of two coplanar triangles win every pixel, whatever float rounding does', () => {
    const corner = (x: number, y: number, height: number) => ({ x, y, height });
    // Heights with no exact 32-bit representation across the triangle.
    const a = corner(0, 0, 2.1);
    const b = corner(40, 3, 2.7);
    const c = corner(5, 40, 2.3);
    const { ids } = compositeScene({
      width: 40,
      height: 40,
      pages: [],
      sprites: [],
      triangles: [
        { id: 1, a, b, c },
        { id: 2, a, b, c },
      ],
    });
    expect([...ids].filter((id) => id === 1)).toEqual([]);
  });
});
