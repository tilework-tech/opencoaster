import type { Page } from '@playwright/test';

export type TerrainFixtureName = 'pit' | 'plateau' | 'terraces' | 'corner';

export interface FixtureView {
  /** Screen rectangle, in CSS pixels, that must be entirely terrain. */
  rect: { x: number; y: number; width: number; height: number };
}

/**
 * Replaces the sandbox map with a flat grass field plus one height fixture and aims the camera at
 * it. `renderer` is `webgl2` or `canvas2d`; the canvas fallback is forced by launching without GL.
 */
export async function loadTerrainFixture(
  page: Page,
  fixture: TerrainFixtureName,
  rotation: number,
  zoom = 2,
): Promise<FixtureView> {
  return page.evaluate(
    async ({ fixture, rotation, zoom }) => {
      const w = window as unknown as {
        __sim: { onMap: (map: unknown, newGame: boolean) => void };
        __map: {
          width: number;
          height: number;
          heights: Uint8Array;
          surface: Uint8Array;
          slope: Uint8Array;
        };
        __camera: { x: number; y: number; zoom: number; rotation: number };
      };
      const { worldToScreen } = await import('/src/render/projection.ts');
      const source = w.__map;
      const { width, height } = source;
      const heights = new Uint8Array(width * height).fill(4);
      const surface = new Uint8Array(width * height);
      const slope = new Uint8Array(width * height);
      const cx = fixture === 'corner' ? width - 4 : width >> 1;
      const cy = fixture === 'corner' ? height - 4 : height >> 1;
      const set = (x0: number, y0: number, w0: number, h0: number, level: number) => {
        for (let y = y0; y < y0 + h0; y++)
          for (let x = x0; x < x0 + w0; x++) heights[y * width + x] = level;
      };
      if (fixture === 'pit') { set(cx - 1, cy - 1, 3, 3, 2); surface[(cy) * width + cx] = 1; }
      if (fixture === 'plateau') set(cx - 1, cy - 1, 3, 3, 8);
      if (fixture === 'terraces') {
        set(cx - 3, cy - 3, 7, 7, 6);
        set(cx - 2, cy - 2, 5, 5, 8);
        set(cx - 1, cy - 1, 3, 3, 10);
      }
      const map = {
        ...source,
        heights,
        surface,
        slope,
        waterLevel: new Uint8Array(width * height),
        pathCount: 0,
        sceneryCount: 0,
      };
      w.__sim.onMap(map, false);
      w.__camera.rotation = rotation;
      w.__camera.zoom = zoom;
      const [sx, sy] = worldToScreen(cx + 0.5, cy + 0.5, 5, rotation as 0, map);
      w.__camera.x = sx;
      w.__camera.y = sy;
      const span = fixture === 'terraces' ? 6 : 4;
      const halfW = span * 32 * zoom * 0.5;
      const halfH = span * 16 * zoom * 0.5 + 40 * zoom;
      return {
        rect: {
          x: Math.round(innerWidth / 2 - halfW),
          y: Math.round(innerHeight / 2 - halfH),
          width: Math.round(halfW * 2),
          height: Math.round(halfH * 2),
        },
      };
    },
    { fixture, rotation, zoom },
  );
}

/** Counts pixels near the renderer's clear colour inside a screenshot region. */
export async function backgroundPixels(
  page: Page,
  rect: FixtureView['rect'],
): Promise<{ count: number; sample: [number, number] | null }> {
  const png = await page.screenshot({ clip: rect });
  return page.evaluate(
    async ({ b64 }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${b64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      let sample: [number, number] | null = null;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i]! <= 20 && data[i + 1]! >= 14 && data[i + 1]! <= 26 && data[i + 2]! <= 32) {
          count++;
          sample ??= [(i / 4) % canvas.width, Math.floor(i / 4 / canvas.width)];
        }
      }
      return { count, sample };
    },
    { b64: png.toString('base64') },
  );
}
