import { GROUND_OBJECT_ID, OBJECT_KINDS, objectKindBit } from '../render/object-kinds';
import { compositeScene } from '../render/occlusion-oracle';
import type { OraclePage } from '../render/occlusion-oracle';
import { scoreOcclusion } from '../render/occlusion-metric';
import { terrainTriangles } from '../render/oracle-terrain';
import type { Camera, MapData } from '../render/renderer';
import { spritePages } from '../render/sprite-pages';
import type { ObjectIdCapture } from '../render/webgl2-renderer';

/**
 * Scores one renderer frame against the occlusion oracle (src/render/occlusion-oracle.ts) for the
 * dev fixtures: the renderer's object-ID capture versus the oracle's z-buffer over the same placed
 * sprites and terrain.
 */
export interface FixtureView {
  map: MapData;
  camera: Camera;
  /** CSS-pixel viewport and device pixel ratio the renderer was sized with. */
  width: number;
  height: number;
  dpr: number;
}

const pageCache = new Map<number, OraclePage>();

function texels(image: ImageBitmap): Uint8ClampedArray {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext('2d')!;
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, image.width, image.height).data;
}

function oraclePage(page: number): OraclePage {
  let cached = pageCache.get(page);
  if (!cached) {
    const colour = spritePages.pageImage(page)!;
    const heights = spritePages.pageHeights(page)!;
    cached = {
      width: colour.width,
      height: colour.height,
      colour: texels(colour),
      heights: texels(heights),
    };
    pageCache.set(page, cached);
  }
  return cached;
}

function oracleFor(capture: ObjectIdCapture, view: FixtureView) {
  const pages: OraclePage[] = [];
  for (const page of capture.pages) pages[page] = oraclePage(page);
  return compositeScene({
    width: capture.width,
    height: capture.height,
    pages,
    sprites: capture.sprites,
    triangles: terrainTriangles(view.map, view.camera, view.width, view.height, view.dpr),
    kindBit: (id) => objectKindBit(capture.kinds.get(id) ?? 'other'),
  });
}

/** Object ids as a PNG data URL: each id hashed to a colour, mismatches optionally overlaid. */
function idImage(ids: Int32Array, width: number, height: number, heat?: Uint8Array): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  const image = context.createImageData(width, height);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const hash = Math.imul(id, 2654435761) >>> 0;
    let r = id === 0 ? 0 : id === GROUND_OBJECT_ID ? 60 : 80 + (hash & 127);
    let g = id === 0 ? 0 : id === GROUND_OBJECT_ID ? 70 : 80 + ((hash >> 8) & 127);
    let b = id === 0 ? 0 : id === GROUND_OBJECT_ID ? 55 : 80 + ((hash >> 16) & 127);
    if (heat?.[i] === 1) [r, g, b] = [255, 0, 40];
    else if (heat?.[i] === 2) [r, g, b] = [255, 200, 0];
    else if (heat) [r, g, b] = [r * 0.35, g * 0.35, b * 0.35];
    image.data.set([r, g, b, 255], i * 4);
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

/** The occlusion score of the current frame, with id and heat-map PNGs when `images` is set. */
export function scoreFrame(capture: ObjectIdCapture, view: FixtureView, images = false) {
  const oracle = oracleFor(capture, view);
  const result = scoreOcclusion({
    oracle: oracle.ids,
    rendered: capture.ids,
    kindMasks: oracle.kindMasks,
    kinds: capture.kinds,
    kindBit: objectKindBit,
  });
  return {
    objectPixels: result.objectPixels,
    mismatched: result.mismatched,
    coverage: result.coverage,
    pairs: result.pairs,
    ...(images
      ? {
          rendered: idImage(capture.ids, capture.width, capture.height),
          oracle: idImage(oracle.ids, capture.width, capture.height),
          heat: idImage(capture.ids, capture.width, capture.height, result.heat),
        }
      : {}),
  };
}

/** Pixels where the oracle shows kind `want` and the renderer kind `got`, for diagnosis. */
export function pairPixels(capture: ObjectIdCapture, view: FixtureView, want: string, got: string) {
  const oracle = oracleFor(capture, view);
  const pixels: { x: number; y: number; oracle: number; rendered: number; height: number }[] = [];
  for (let i = 0; i < oracle.ids.length; i++) {
    const o = oracle.ids[i];
    const r = capture.ids[i];
    if (o === r || capture.kinds.get(o) !== want || capture.kinds.get(r) !== got) continue;
    pixels.push({
      x: i % capture.width,
      y: Math.floor(i / capture.width),
      oracle: o,
      rendered: r,
      height: oracle.heights[i],
    });
  }
  const sprites = capture.sprites.filter((sprite) =>
    pixels.some((p) => p.oracle === sprite.id || p.rendered === sprite.id),
  );
  return { pixels, sprites };
}

/**
 * The object kind seen at every pixel, one character per pixel: `@` for nothing, otherwise
 * `A` plus the kind's index in OBJECT_KINDS. Lets two renderers be compared kind for kind.
 */
export function kindString(capture: ObjectIdCapture): string {
  const codes = new Uint16Array(capture.ids.length);
  for (let i = 0; i < codes.length; i++) {
    const id = capture.ids[i];
    const kind = id === 0 ? undefined : capture.kinds.get(id);
    const index = kind === undefined ? -1 : OBJECT_KINDS.indexOf(kind as never);
    codes[i] = id === 0 ? 64 : 65 + (index < 0 ? OBJECT_KINDS.length - 1 : index);
  }
  let out = '';
  for (let i = 0; i < codes.length; i += 4096)
    out += String.fromCharCode(...codes.subarray(i, i + 4096));
  return out;
}
