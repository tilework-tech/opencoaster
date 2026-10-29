// Captures one renderer backend per browser process and refuses to report an image or
// timing unless the game world is demonstrably present and the GL context is alive.
//
//   BACKEND=webgl2|canvas2d  required; the other renderer is never instantiated
//   BASE_URL                 dev server (default http://127.0.0.1:5173/)
//   MOBILE=1                 390x844 viewport
//   CONDITIONS=a,b           subset of clear-day,rainy-day,clear-night,rainy-night,storm-night
//   SAMPLES=50               timed frames per condition (0 skips timing)
//   REPRODUCE_OVERLAP=1      negative control: also create the other renderer on top, which
//                            must make the validity gate fail (this was the v1 harness bug)
//
// Usage: node capture-lighting.mjs <outDir>
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? '.local/before';
const backend = process.env.BACKEND;
if (backend !== 'webgl2' && backend !== 'canvas2d')
  throw new Error('BACKEND must be webgl2 or canvas2d (one backend per browser process)');
const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const sampleCount = Number(process.env.SAMPLES ?? 50);
const reproduceOverlap = process.env.REPRODUCE_OVERLAP === '1';
const mobile = process.env.MOBILE === '1';
const width = mobile ? 390 : 1000;
const height = mobile ? 844 : 700;
const zoom = mobile ? 0.65 : 0.92;
const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: { width, height } });
const page = await context.newPage();
const problems = [];
page.on('console', (message) => {
  console.log(`[browser ${message.type()}] ${message.text()}`);
  if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
});
page.on('pageerror', (error) => {
  console.log(`[browser error] ${error.message}`);
  problems.push(`page error: ${error.message}`);
});
await page.goto(baseUrl);
await page.waitForLoadState('domcontentloaded');
await page.evaluate(async () => {
  for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
  for (const key of await caches.keys()) await caches.delete(key);
});
await page.reload();
await page.waitForLoadState('domcontentloaded');
await mkdir(out, { recursive: true });
const result = await page.evaluate(async ({ only, width, height, zoom, mobile, reproduceOverlap }) => {
  const [
    { inspectionShowcase },
    { deserialize },
    { createSnapshot, writeSnapshot },
    { extractMapData },
    { Canvas2DRenderer },
    { WebGL2Renderer },
    { spritePages },
    { setTileHeight },
    { placeScenery, SceneryItem },
    { placePath, setPathAddition, PathAddition },
    { project },
    lighting,
  ] = await Promise.all([
    import('/e2e/support/inspection-showcase.ts'),
    import('/src/save/save.ts'),
    import('/src/worker/snapshot.ts'),
    import('/src/worker/map-data.ts'),
    import('/src/render/canvas2d-renderer.ts'),
    import('/src/render/webgl2-renderer.ts'),
    import('/src/render/sprite-pages.ts'),
    import('/src/sim/map/land.ts'),
    import('/src/sim/map/scenery.ts'),
    import('/src/sim/map/paths.ts'),
    import('/src/render/projection.ts'),
    import('/src/render/night-lighting.ts'),
  ]);
  spritePages.start();
  const manifest = await fetch('/sprites/manifest.json').then((r) => r.json());
  console.log('manifest fetched', Object.keys(manifest.categories).length);
  spritePages.install(manifest, new Map());
  const categories = ['coaster-wood', 'people', 'vehicles', 'world'];
  for (const category of categories) spritePages.requestCategory(category);

  const world = deserialize(inspectionShowcase());
  const map = world.map;
  for (const [x, y, level] of [[14, 14, 4], [16, 16, 3], [24, 23, 4], [26, 22, 3]])
    setTileHeight(map, x, y, level);
  for (const [x, y, item] of [
    [13, 15, SceneryItem.OakTree], [16, 13, SceneryItem.BlossomTree],
    [25, 19, SceneryItem.Conifer], [27, 22, SceneryItem.Birch],
    [17, 25, SceneryItem.FlowerBed], [24, 27, SceneryItem.Shrub],
  ]) placeScenery(map, x, y, item);
  for (let x = 14; x <= 28; x++) {
    placePath(map, { x, y: 25, queue: false });
    if (x % 2 === 0) setPathAddition(map, x, 25, PathAddition.Lamp);
  }
  const snapshot = createSnapshot({
    guests: 300, staff: 64, vehicles: 32, cars: 256, litter: 128,
    rides: 256, tracks: 8192, mapTiles: map.width * map.height,
  });
  writeSnapshot(world, snapshot);
  const mapData = extractMapData(map);
  const center = new Float64Array(2);
  project((mobile ? 19.8 : 20) * 256 + 128, 20 * 256 + 128, 2 * 64, map.width, map.height, 0, center);
  const renderers = {};
  const stores = [spritePages];
  const backends = [['webgl2', WebGL2Renderer], ['canvas2d', Canvas2DRenderer]];
  const created = reproduceOverlap ? backends : backends.filter(([name]) => name === only);
  let contextLosses = 0;
  for (const [name, Renderer] of created) {
    const canvas = document.createElement('canvas');
    canvas.id = `proof-${name}`;
    canvas.style.cssText = `position:fixed;inset:0;width:${width}px;height:${height}px;z-index:1000`;
    canvas.addEventListener('webglcontextlost', () => { contextLosses++; });
    document.body.append(canvas);
    const renderer = new Renderer();
    renderer.attach(canvas);
    renderer.resize(width, height, 1);
    renderer.setMap(mapData);
    renderer.setLandOverlay(true);
    renderer.setSpriteGhosts([
      { x: 28, y: 26, level: mapData.heights[26 * map.width + 28], sprite: 'scenery/flower-bed/view-0', kind: 'scenery', tone: 'ok' },
    ]);
    renderers[name] = { canvas, renderer };
    if (name === 'canvas2d') stores.push(renderer.atlas);
  }
  const deadline = Date.now() + 120_000;
  for (const store of stores) {
    while (store.pageInfos.length === 0) await new Promise((r) => setTimeout(r, 25));
    for (const category of categories) store.requestCategory(category);
    while (categories.some((category) => !store.isLoaded(category))) {
      if (Date.now() > deadline)
        throw new Error(`required sprite pages did not finish loading: ${categories.filter((category) => !store.isLoaded(category)).join(', ')}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const overlay = document.createElement('div');
  overlay.className = 'weather-overlay weather-sunny';
  overlay.style.zIndex = '1001';
  document.body.append(overlay);

  // Scene presence: a rendered world has many distinct colours and real contrast. A blank
  // clear colour (or a cleared canvas under DOM rain streaks) has neither.
  const sceneStats = (rgba, w, h) => {
    const colours = new Set();
    let n = 0, sum = 0, sumSq = 0, lit = 0;
    for (let y = Math.floor(h * 0.15); y < Math.floor(h * 0.85); y += 2) {
      for (let x = Math.floor(w * 0.1); x < Math.floor(w * 0.9); x += 2) {
        const i = (y * w + x) * 4;
        const lum = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
        colours.add(((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3));
        sum += lum; sumSq += lum * lum; n++;
        if (lum > 40) lit++;
      }
    }
    const mean = sum / n;
    return {
      uniqueColours: colours.size,
      meanLuma: +mean.toFixed(1),
      lumaStdDev: +Math.sqrt(Math.max(0, sumSq / n - mean * mean)).toFixed(1),
      litFraction: +(lit / n).toFixed(3),
    };
  };
  const readCanvas = (name) => {
    const { canvas } = renderers[name];
    if (name === 'webgl2') {
      const gl = canvas.getContext('webgl2');
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      // GL rows are bottom-up; the stats region is vertically symmetric enough but flip anyway.
      const flipped = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) flipped.set(buf.subarray(y * w * 4, (y + 1) * w * 4), (h - 1 - y) * w * 4);
      return sceneStats(flipped, w, h);
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return sceneStats(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  };
  const glAlive = (name) => name !== 'webgl2' || !renderers[name].canvas.getContext('webgl2').isContextLost();
  // Nothing but the proof canvas (and the DOM weather overlay) may sit over the scene centre.
  const coveredBy = (name) => {
    const stack = document.elementsFromPoint(Math.floor(width / 2), Math.floor(height / 2))
      .filter((el) => !el.classList.contains('weather-overlay'));
    return stack[0]?.id === `proof-${name}` ? null : (stack[0]?.id || stack[0]?.tagName);
  };
  const state = {
    frame(name, condition) {
      const { renderer } = renderers[name];
      const { hour, weather } = condition;
      snapshot.tick = Math.round((((((hour - 8) / 24) % 1) + 1) % 1) * lighting.TICKS_PER_NIGHT_CYCLE);
      snapshot.weather.kind = weather === 'rain' ? 2 : weather === 'storm' ? 3 : 0;
      overlay.className = `weather-overlay weather-${weather}`;
      renderer.draw(snapshot, {
        x: center[0], y: center[1], zoom, rotation: 0,
        dayNight: hour !== 12, lampLights: hour !== 12,
      });
    },
    capture(name, condition) {
      this.frame(name, condition);
      return {
        canvas: readCanvas(name),
        coveredBy: coveredBy(name),
        contextAlive: glAlive(name),
        contextLosses,
        spritesLoaded: stores.every((store) => categories.every((category) => store.isLoaded(category))),
      };
    },
    benchmark(name, condition, count) {
      for (let i = 0; i < 10; i++) this.frame(name, condition);
      const samples = [];
      for (let i = 0; i < count; i++) {
        const start = performance.now();
        this.frame(name, condition);
        if (name === 'webgl2') {
          const gl = renderers[name].canvas.getContext('webgl2');
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        } else {
          renderers[name].canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, 1, 1);
        }
        samples.push(performance.now() - start);
      }
      const sorted = [...samples].sort((a, b) => a - b);
      const last = this.capture(name, condition);
      return {
        median: sorted[Math.floor(sorted.length / 2)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        count,
        samples,
        endCheck: last,
      };
    },
    async analyseImage(base64) {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const c = document.createElement('canvas');
      c.width = bitmap.width; c.height = bitmap.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0);
      return sceneStats(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
    },
  };
  window.__lightingProof = state;
  return {
    backend: only, categories, map: [map.width, map.height], guests: snapshot.guests.count,
    rides: snapshot.rides.count, tracks: snapshot.tracks.count, pathLamps: mapData.pathCount,
    renderersInstantiated: created.map(([name]) => name),
  };
}, { only: backend, width, height, zoom, mobile, reproduceOverlap });

// Thresholds sit well below every valid capture measured for this scene (see reports/
// in the proof bundle) and far above a blank scene with rain streaks.
const MIN_UNIQUE_COLOURS = 150;
const MIN_LUMA_STDDEV = 6;
const MIN_LIT_FRACTION = 0.02;
const sceneProblem = (stats) =>
  stats.uniqueColours < MIN_UNIQUE_COLOURS ? `only ${stats.uniqueColours} distinct colours`
  : stats.lumaStdDev < MIN_LUMA_STDDEV ? `luma stddev ${stats.lumaStdDev}`
  : stats.litFraction < MIN_LIT_FRACTION ? `lit fraction ${stats.litFraction}`
  : null;
const checkProblems = (label, check) => {
  const found = [];
  const scene = sceneProblem(check.canvas);
  if (scene) found.push(`${label}: scene absent (${scene})`);
  if (check.coveredBy) found.push(`${label}: canvas covered by #${check.coveredBy}`);
  if (!check.contextAlive || check.contextLosses > 0) found.push(`${label}: WebGL context lost`);
  if (!check.spritesLoaded) found.push(`${label}: required sprite pages not loaded`);
  return found;
};

const conditions = {
  'clear-day': { hour: 12, weather: 'sunny' },
  'rainy-day': { hour: 12, weather: 'rain' },
  'clear-night': { hour: 0, weather: 'sunny' },
  'rainy-night': { hour: 0, weather: 'rain' },
  'storm-night': { hour: 0, weather: 'storm' },
};
const selectedConditions = process.env.CONDITIONS
  ? Object.entries(conditions).filter(([label]) => process.env.CONDITIONS.split(',').includes(label))
  : Object.entries(conditions);
const report = { backend, mobile, baseUrl, viewport: { width, height }, setup: result, conditions: {} };
for (const [label, condition] of selectedConditions) {
  const entry = { checks: null, screenshotStats: null, timing: null, problems: [] };
  entry.checks = await page.evaluate(([name, state]) => window.__lightingProof.capture(name, state), [backend, condition]);
  await page.waitForTimeout(60);
  const file = `${out}/${mobile ? 'mobile-' : ''}${backend}-${label}.png`;
  const shot = await page.screenshot({ path: file, animations: 'disabled' });
  entry.screenshotStats = await page.evaluate((b64) => window.__lightingProof.analyseImage(b64), shot.toString('base64'));
  entry.problems.push(...checkProblems('canvas', entry.checks));
  const shotProblem = sceneProblem(entry.screenshotStats);
  if (shotProblem) entry.problems.push(`screenshot: scene absent (${shotProblem})`);
  if (sampleCount > 0) {
    entry.timing = await page.evaluate(([name, state, n]) => window.__lightingProof.benchmark(name, state, n), [backend, condition, sampleCount]);
    entry.problems.push(...checkProblems('after timing', entry.timing.endCheck));
  }
  report.conditions[label] = entry;
}
report.pageProblems = problems;
report.valid = problems.length === 0 && Object.values(report.conditions).every((entry) => entry.problems.length === 0);
await writeFile(`${out}/${mobile ? 'mobile-' : ''}report-${backend}.json`, JSON.stringify(report, null, 2));
const summary = Object.fromEntries(Object.entries(report.conditions).map(([label, entry]) => [
  label,
  { problems: entry.problems, screenshot: entry.screenshotStats, median: entry.timing?.median, p95: entry.timing?.p95 },
]));
console.log(JSON.stringify({ valid: report.valid, pageProblems: problems, summary }, null, 2));
await browser.close();
if (!report.valid) {
  console.error('INVALID CAPTURE: scene absent, canvas covered, or context lost. Do not use these images or timings.');
  process.exit(1);
}
