import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import { GROUND_OBJECT_ID, objectKindBit } from '../render/object-kinds';
import { compositeScene } from '../render/occlusion-oracle';
import type { OraclePage } from '../render/occlusion-oracle';
import { scoreOcclusion } from '../render/occlusion-metric';
import { terrainTriangles } from '../render/oracle-terrain';
import { project } from '../render/projection';
import type { Rotation } from '../render/projection';
import type { Camera } from '../render/renderer';
import { spritePages } from '../render/sprite-pages';
import { WebGL2Renderer } from '../render/webgl2-renderer';
import { Canvas2DRenderer } from '../render/canvas2d-renderer';
import { buildFuzzPark } from './occlusion-fuzz';

/**
 * Dev-only page scoring a renderer's per-pixel object ownership against the occlusion oracle on
 * a fuzzed park. Query: seed, rot=0..3, zoom, w/h viewport. `window.__score()` returns the score
 * and heat maps (see src/dev/docs.md).
 */
const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 1);
const rotation = (Number(params.get('rot') ?? 0) % 4) as Rotation;
const zoom = Number(params.get('zoom') ?? 1);
const viewWidth = Number(params.get('w') ?? 800);
const viewHeight = Number(params.get('h') ?? 600);
const backend = params.get('renderer') === 'canvas2d' ? 'canvas2d' : 'webgl2';

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

async function main(): Promise<void> {
  const park = buildFuzzPark(seed);
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const renderer = backend === 'canvas2d' ? new Canvas2DRenderer() : new WebGL2Renderer();
  renderer.attach(canvas);
  // `painter=1` measures the Canvas2D renderer without its depth composite.
  if (params.get('painter') === '1') (renderer as unknown as { surface: null }).surface = null;
  renderer.resize(viewWidth, viewHeight, 1);
  canvas.style.width = `${viewWidth}px`;
  canvas.style.height = `${viewHeight}px`;
  renderer.setMap(park.map);
  const centre = new Float64Array(2);
  // focus=gate or focus=boarding:<i> centres a ride entrance/exit or the park gate.
  const focus = params.get('focus') ?? '';
  const { x, y, z } =
    focus === 'gate'
      ? park.landmarks.gate
      : focus.startsWith('boarding:')
        ? (park.landmarks.boarding[Number(focus.slice(9))] ?? park.focus)
        : park.focus;
  project(
    x * TILE_UNITS,
    y * TILE_UNITS,
    z * Z_STEP,
    park.map.width,
    park.map.height,
    rotation,
    centre,
  );
  const camera: Camera = { x: centre[0], y: centre[1], zoom, rotation };
  // Lazy sprite categories load on first use; draw until the frame stops changing.
  let previous = '';
  let stable = 0;
  for (let i = 0; i < 400 && stable < 6; i++) {
    renderer.draw(park.snapshot, camera);
    const current = canvas.toDataURL();
    stable = current === previous ? stable + 1 : 0;
    previous = current;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  renderer.draw(park.snapshot, camera);

  const score = (images = false) => {
    const capture = renderer.captureObjectIds(park.snapshot, camera);
    const pages: OraclePage[] = [];
    for (const page of capture.pages) pages[page] = oraclePage(page);
    const oracle = compositeScene({
      width: capture.width,
      height: capture.height,
      pages,
      sprites: capture.sprites,
      triangles: terrainTriangles(park.map, camera, viewWidth, viewHeight, 1),
      kindBit: (id) => objectKindBit(capture.kinds.get(id) ?? 'other'),
    });
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
  };
  /** Median and worst wall time, in ms, of `frames` draws of the fixture view. */
  const time = (frames = 30) => {
    const samples: number[] = [];
    for (let i = 0; i < frames; i++) {
      const start = performance.now();
      renderer.draw(park.snapshot, camera);
      if (backend === 'webgl2') canvas.getContext('webgl2')?.finish();
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    return { median: samples[Math.floor(frames / 2)], worst: samples[frames - 1] };
  };
  Object.assign(window, { __score: score, __time: time, __ready: true });
}

void main();
