import { describe, expect, it } from 'vitest';
import { SCENERY_CATALOG } from '../../src/sim/map/scenery';
import { sceneryBox } from '../../src/render/ground-anchor';
import { SCENERY_MODELS } from './models/scenery';
import { physicalToLevels, rotateMesh, PHYSICAL_Z } from './mesh';
import { renderMesh, TRANSPARENT } from './raster';
import type { Sprite } from './raster';

const native = SCENERY_CATALOG.filter((item) => item.native);

function view(sprite: string, quarterTurns: number): Sprite {
  return renderMesh(rotateMesh(physicalToLevels(SCENERY_MODELS[sprite]!()), quarterTurns));
}

function opaque(sprite: Sprite): number {
  return sprite.pixels.reduce((count, pixel) => count + (pixel === TRANSPARENT ? 0 : 1), 0);
}

describe('decoration models', () => {
  it('has a model for every native catalog item and no stray models', () => {
    expect(Object.keys(SCENERY_MODELS).sort()).toEqual(native.map((item) => item.sprite).sort());
  });

  it.each(native.map((item) => [item.name, item] as const))(
    '%s stands on its tile, inside its box, at a height matching its clearance',
    (_name, item) => {
      for (let turns = 0; turns < 4; turns++) {
        const sprite = view(item.sprite, turns);
        const box = sceneryBox(item);
        // Native sprites are laid on a 64px tile; nothing may be wider than a tile.
        expect(sprite.width).toBeLessThanOrEqual(66);
        expect(sprite.width).toBeLessThanOrEqual(box.width + 2);
        // Above the anchor: within the clearance the sim reserves, plus up to a tile's half
        // diagonal for the part of the model lying behind the tile centre.
        expect(sprite.anchor.y).toBeLessThanOrEqual(box.height + 18);
        // Below the anchor only the tile's half-diagonal may show (no floating or sunk art).
        expect(sprite.height - sprite.anchor.y).toBeLessThanOrEqual(18);
        expect(opaque(sprite)).toBeGreaterThan(150);
      }
    },
  );

  it.each(native.map((item) => [item.name, item] as const))(
    '%s reserves the vertical space the model occupies',
    (_name, item) => {
      const mesh = SCENERY_MODELS[item.sprite]!();
      const top = Math.max(...mesh.flatMap((t) => t.v.map((p) => p[2])));
      expect(item.height).toBe(Math.max(1, Math.ceil((top * PHYSICAL_Z) / 1 - 1e-6)));
    },
  );

  it('draws every directional model differently when quarter-turned', () => {
    for (const item of native.filter((entry) => entry.directional)) {
      const hashes = [0, 1, 2, 3].map((turns) => view(item.sprite, turns).pixels.join(','));
      expect(new Set(hashes).size, item.name).toBeGreaterThanOrEqual(2);
    }
  });

  it('looks meaningfully different from every other decoration', () => {
    const silhouettes = native.map((item) => {
      const sprite = view(item.sprite, 0);
      return { name: item.name, sprite };
    });
    for (let a = 0; a < silhouettes.length; a++)
      for (let b = a + 1; b < silhouettes.length; b++) {
        const first = silhouettes[a]!.sprite;
        const second = silhouettes[b]!.sprite;
        const width = Math.max(first.width, second.width);
        const height = Math.max(first.anchor.y, second.anchor.y);
        let differing = 0;
        let union = 0;
        for (let y = -height; y < 20; y++)
          for (let x = -width / 2; x < width / 2; x++) {
            const at = (s: Sprite): boolean => {
              const px = Math.round(x + s.anchor.x);
              const py = Math.round(y + s.anchor.y);
              return (
                px >= 0 &&
                py >= 0 &&
                px < s.width &&
                py < s.height &&
                s.pixels[py * s.width + px] !== TRANSPARENT
              );
            };
            const colour = (s: Sprite, cx: number, cy: number): number =>
              s.pixels[Math.round(cy + s.anchor.y) * s.width + Math.round(cx + s.anchor.x)]!;
            const one = at(first);
            const two = at(second);
            if (one || two) union++;
            if (one !== two || (one && colour(first, x, y) !== colour(second, x, y))) differing++;
          }
        expect(
          differing / union,
          `${silhouettes[a]!.name} vs ${silhouettes[b]!.name}`,
        ).toBeGreaterThan(0.2);
      }
  });
});
