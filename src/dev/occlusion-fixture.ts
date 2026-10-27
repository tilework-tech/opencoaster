import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import { project } from '../render/projection';
import type { Rotation } from '../render/projection';
import type { Camera } from '../render/renderer';
import { WebGL2Renderer } from '../render/webgl2-renderer';
import { Canvas2DRenderer } from '../render/canvas2d-renderer';
import { buildFuzzPark } from './occlusion-fuzz';
import { pairPixels, scoreFrame } from './oracle-score';

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
const dpr = Number(params.get('dpr') ?? 1);
const backend = params.get('renderer') === 'canvas2d' ? 'canvas2d' : 'webgl2';
/** The land overlay is on unless land=0, so the boundary and its overlay are scored. */
const landOverlay = params.get('land') !== '0';

async function main(): Promise<void> {
  const park = buildFuzzPark(seed);
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const renderer = backend === 'canvas2d' ? new Canvas2DRenderer() : new WebGL2Renderer();
  renderer.attach(canvas);
  // `painter=1` measures the Canvas2D renderer without its depth composite.
  if (params.get('painter') === '1') (renderer as unknown as { surface: null }).surface = null;
  renderer.resize(viewWidth, viewHeight, dpr);
  canvas.style.width = `${viewWidth}px`;
  canvas.style.height = `${viewHeight}px`;
  renderer.setMap(park.map);
  renderer.setLandOverlay(landOverlay);
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

  const view = { map: park.map, camera, width: viewWidth, height: viewHeight, dpr, landOverlay };
  const score = (images = false) =>
    scoreFrame(renderer.captureObjectIds(park.snapshot, camera), view, images);
  const pairs = (want: string, got: string) =>
    pairPixels(renderer.captureObjectIds(park.snapshot, camera), view, want, got);
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
  const bench = async () => {
    const phases = new Map<string, number[]>();
    const measureMethod = (target: object, name: string, label: string): void => {
      const methods = target as Record<string, (...args: unknown[]) => unknown>;
      const original = methods[name];
      if (!original) return;
      methods[name] = function (this: unknown, ...args: unknown[]) {
        const start = performance.now();
        try {
          return original.apply(this, args);
        } finally {
          const values = phases.get(label) ?? [];
          values.push(performance.now() - start);
          phases.set(label, values);
        }
      };
    };
    if (backend === 'webgl2') {
      measureMethod(renderer, 'drawGroundChunks', 'ground colour cache');
      measureMethod(renderer, 'drawGroundDepth', 'depth-only terrain');
      measureMethod(renderer, 'drawRuns', 'sprite draw submission');
      measureMethod(renderer, 'renderFrame', 'renderer CPU frame');
    } else {
      const surface = (renderer as unknown as { surface: object | null }).surface;
      if (surface) {
        measureMethod(surface, 'compose', 'Canvas2D depth composite');
        measureMethod(surface, 'finish', 'Canvas2D composite writeback');
      }
    }
    const gl = backend === 'webgl2' ? canvas.getContext('webgl2') : null;
    for (let i = 0; i < 60; i++) {
      renderer.draw(park.snapshot, camera);
      gl?.finish();
    }
    const totals: number[] = [];
    const drawCpu: number[] = [];
    const batches: number[] = [];
    for (let batch = 0; batch < 9; batch++) {
      const samples: number[] = [];
      for (let frame = 0; frame < 20; frame++) {
        const cpuStart = performance.now();
        renderer.draw(park.snapshot, camera);
        drawCpu.push(performance.now() - cpuStart);
        gl?.finish();
        samples.push(performance.now() - cpuStart);
      }
      samples.sort((a, b) => a - b);
      batches.push(samples[10]!);
    }
    totals.push(...batches);
    const med = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)] ?? 0;
    };
    const phaseMedians = Object.fromEntries(
      [...phases].map(([name, values]) => [name, med(values)]),
    );
    return {
      completedFrameMedianMs: med(totals),
      drawCpuMedianMs: med(drawCpu),
      passCpuMedianMs: phaseMedians,
      batchesMs: batches,
      sampling: '60 warm frames, 9 batches × 20 completed frames',
    };
  };
  const raf = async (frames = 300): Promise<number[]> =>
    new Promise((resolve) => {
      const samples: number[] = [];
      let previous = performance.now();
      const next = (now: number): void => {
        samples.push(now - previous);
        previous = now;
        if (samples.length >= frames) resolve(samples);
        else requestAnimationFrame(next);
      };
      requestAnimationFrame(next);
    });
  if (params.get('rain') === '1') document.body.classList.add('rain-active');
  Object.assign(window, {
    __score: score,
    __time: time,
    __bench: bench,
    __raf: raf,
    __pairPixels: pairs,
    __ready: true,
  });
}

void main();
