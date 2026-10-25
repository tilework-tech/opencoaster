import { mkdir, writeFile as writeBytes } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import sharp from 'sharp';
import { project } from '../../src/render/projection';
import type { Rotation } from '../../src/render/projection';
import { TILE_UNITS, Z_STEP } from '../../src/sim/core/constants';
import type { Tile } from './park';

/** Starter Park is square. */
const MAP_SIZE = 64;

/** Ground height level of the Starter Park around its build area. */
export const STARTER_GROUND_LEVEL = 2;

/** A decoded screenshot: raw RGBA pixels in device pixels. */
export interface Shot {
  png: Buffer;
  data: Buffer;
  width: number;
  height: number;
  /** Device pixels per CSS pixel. */
  scale: number;
  /** Page position, in CSS px, of the screenshot's top-left corner. */
  origin: { x: number; y: number };
}

/** Axis-aligned box in CSS pixels. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Pixels of the game canvas when it is a Canvas2D surface. Compositing a page screenshot over a
 * software-rendered Canvas2D world can take far longer than a frame budget, whereas reading the
 * canvas back is immediate; null when the canvas is WebGL.
 */
async function canvas2dShot(page: Page, clip?: Box): Promise<Shot | null> {
  const grab = await page.evaluate(() => {
    const canvas = document.querySelector('#game') as HTMLCanvasElement | null;
    if (!canvas || canvas.getContext('2d') === null) return null;
    const rect = canvas.getBoundingClientRect();
    return { url: canvas.toDataURL('image/png'), x: rect.x, y: rect.y, width: rect.width };
  });
  if (!grab) return null;
  const full = Buffer.from(grab.url.split(',')[1]!, 'base64');
  const meta = await sharp(full).metadata();
  const scale = meta.width! / grab.width;
  const pipeline = sharp(full);
  if (clip)
    pipeline.extract({
      left: Math.max(0, Math.round((clip.x - grab.x) * scale)),
      top: Math.max(0, Math.round((clip.y - grab.y) * scale)),
      width: Math.min(meta.width!, Math.round(clip.width * scale)),
      height: Math.min(meta.height!, Math.round(clip.height * scale)),
    });
  const png = await pipeline.png().toBuffer();
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    png,
    data,
    width: info.width,
    height: info.height,
    scale,
    origin: { x: clip?.x ?? grab.x, y: clip?.y ?? grab.y },
  };
}

/** Screenshot of the viewport, or of `clip` alone, which renders much faster under SwiftShader. */
export async function takeShot(page: Page, clip?: Box): Promise<Shot> {
  const canvasShot = await canvas2dShot(page, clip);
  if (canvasShot) return canvasShot;
  const png = await page.screenshot({ timeout: 30_000, ...(clip ? { clip } : {}) });
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const cssWidth = clip?.width ?? page.viewportSize()?.width ?? info.width;
  return {
    png,
    data,
    width: info.width,
    height: info.height,
    scale: info.width / cssWidth,
    origin: { x: clip?.x ?? 0, y: clip?.y ?? 0 },
  };
}

function differs(a: Shot, b: Shot, x: number, y: number): boolean {
  const i = (y * a.width + x) * 4;
  return (
    Math.abs(a.data[i] - b.data[i]) +
      Math.abs(a.data[i + 1] - b.data[i + 1]) +
      Math.abs(a.data[i + 2] - b.data[i + 2]) >
    24
  );
}

/** CSS px² of `box` whose pixels differ between two screenshots of the same page. */
export function changedArea(before: Shot, after: Shot, box: Box): number {
  const x0 = Math.max(0, Math.round((box.x - after.origin.x) * after.scale));
  const y0 = Math.max(0, Math.round((box.y - after.origin.y) * after.scale));
  const x1 = Math.min(after.width, Math.round((box.x + box.width - after.origin.x) * after.scale));
  const y1 = Math.min(
    after.height,
    Math.round((box.y + box.height - after.origin.y) * after.scale),
  );
  let count = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) if (differs(before, after, x, y)) count++;
  return count / (after.scale * after.scale);
}

/**
 * Where a point given in continuous tile units (the tile (3, 4) spans 3-4 by 4-5) lands on
 * screen, in page CSS pixels, from the camera the dev build exposes. Valid in every view
 * rotation, unlike the click helper that assumes the default one.
 */
export async function screenPointOfTileCoord(
  page: Page,
  [x, y]: readonly [number, number],
  level = STARTER_GROUND_LEVEL,
): Promise<{ x: number; y: number }> {
  const view = await page.evaluate(() => {
    const camera = (
      window as unknown as { __camera: { x: number; y: number; zoom: number; rotation: number } }
    ).__camera;
    const game = document.querySelector('#game')!.getBoundingClientRect();
    return { camera: { ...camera }, game: { x: game.x, y: game.y, w: game.width, h: game.height } };
  });
  const out = new Float64Array(2);
  project(
    x * TILE_UNITS,
    y * TILE_UNITS,
    level * Z_STEP,
    MAP_SIZE,
    MAP_SIZE,
    view.camera.rotation as Rotation,
    out,
  );
  return {
    x: view.game.x + view.game.w / 2 + (out[0] - view.camera.x) * view.camera.zoom,
    y: view.game.y + view.game.h / 2 + (out[1] - view.camera.y) * view.camera.zoom,
  };
}

/** Writes a JPEG of `box` (CSS px) cut from a screenshot, shrunk to `width` CSS px wide. */
export async function cropJpeg(shot: Shot, box: Box, width: number): Promise<Buffer> {
  const left = Math.max(0, Math.round((box.x - shot.origin.x) * shot.scale));
  const top = Math.max(0, Math.round((box.y - shot.origin.y) * shot.scale));
  const w = Math.min(shot.width - left, Math.round(box.width * shot.scale));
  const h = Math.min(shot.height - top, Math.round(box.height * shot.scale));
  return sharp(shot.png)
    .extract({ left, top, width: w, height: h })
    .resize({ width })
    .jpeg({ quality: 70, mozjpeg: true })
    .toBuffer();
}

/** Lays equal-sized JPEG panes side by side, `columns` per row. */
export async function sheetJpeg(panes: readonly Buffer[], columns: number): Promise<Buffer> {
  const sizes = await Promise.all(panes.map((pane) => sharp(pane).metadata()));
  const width = Math.max(...sizes.map((s) => s.width!));
  const height = Math.max(...sizes.map((s) => s.height!));
  const rows = Math.ceil(panes.length / columns);
  return sharp({
    create: {
      width: width * columns,
      height: height * rows,
      channels: 3,
      background: '#202020',
    },
  })
    .composite(
      panes.map((input, index) => ({
        input,
        left: (index % columns) * width,
        top: Math.floor(index / columns) * height,
      })),
    )
    .jpeg({ quality: 70, mozjpeg: true })
    .toBuffer();
}

export async function writeFile(path: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeBytes(path, bytes);
}

/**
 * A page point that picks `tile` in the current camera, found with the game's own picking code
 * against the Starter Park terrain so slopes and height steps cannot send the click to a
 * neighbour. Valid in every view rotation while the terrain is unchanged around the tile.
 */
export async function tilePickPoint(page: Page, tile: Tile): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(async ([tx, ty]) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const [{ pickTile }, { findScenario }, { World }, { prepareScenario }] = await Promise.all([
      load('/src/render/projection.ts'),
      load('/src/sim/scenario/catalog.ts'),
      load('/src/sim/core/world.ts'),
      load('/src/sim/scenario/scenario-layout.ts'),
    ]);
    const def = findScenario('starter');
    const world = new World({ seed: def.seed, width: def.mapWidth, height: def.mapHeight });
    prepareScenario(world, def);
    const camera = (window as unknown as { __camera: Record<string, number> }).__camera;
    const game = document.querySelector('#game')!.getBoundingClientRect();
    const viewport = { width: game.width, height: game.height };
    let best: { x: number; y: number; distance: number } | null = null;
    for (let y = 0; y < viewport.height; y += 4)
      for (let x = 0; x < viewport.width; x += 4) {
        const picked = pickTile(x, y, world.map, camera, viewport);
        if (!picked || picked[0] !== tx || picked[1] !== ty) continue;
        const distance = Math.hypot(x - viewport.width / 2, y - viewport.height / 2);
        if (!best || distance < best.distance) best = { x, y, distance };
      }
    return best ? { x: game.x + best.x, y: game.y + best.y } : null;
  }, tile);
  if (!point) throw new Error(`Tile ${tile.join(', ')} is not on screen`);
  return point;
}

/**
 * The ring tiles the boarding candidates may be offered on in the Starter Park's own terrain:
 * buildable, dry, flat and clear of scenery. Footpath tiles count as clear.
 */
export async function flatRingTiles(page: Page, ring: readonly Tile[]): Promise<Tile[]> {
  return page.evaluate(
    async (tiles) => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const [{ findScenario }, { World }, { prepareScenario }, { Surface }] = await Promise.all([
        load('/src/sim/scenario/catalog.ts'),
        load('/src/sim/core/world.ts'),
        load('/src/sim/scenario/scenario-layout.ts'),
        load('/src/sim/map/tile-map.ts'),
      ]);
      const def = findScenario('starter');
      const world = new World({ seed: def.seed, width: def.mapWidth, height: def.mapHeight });
      prepareScenario(world, def);
      const map = world.map;
      return tiles.filter(([x, y]) => {
        if (!map.inBounds(x, y)) return false;
        const i = map.index(x, y);
        return (
          map.canBuild(i) &&
          map.surface[i] !== Surface.Water &&
          map.slope[i] === 0 &&
          (map.waterLevel?.[i] ?? 0) <= map.heights[i] &&
          (map.firstElement(i) < 0 || map.surface[i] === Surface.Path)
        );
      });
    },
    ring.map(([x, y]) => [x, y] as [number, number]),
  );
}

/**
 * The boarding candidates offered must be exactly the ring tiles the terrain allows: the ring
 * around the whole footprint, minus tiles that are sloped, wet, unowned or hold scenery.
 */
export async function expectRingCandidates(
  page: Page,
  candidates: Locator,
  ring: readonly Tile[],
): Promise<void> {
  const offered = (
    await candidates.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')))
  )
    .map((label) =>
      label!
        .match(/tile (\d+), (\d+)/)!
        .slice(1)
        .join(', '),
    )
    .sort();
  const allowed = (await flatRingTiles(page, ring)).map((tile) => tile.join(', ')).sort();
  expect(offered, `entrance candidates around a ${ring.length}-tile ring`).toEqual(allowed);
}
