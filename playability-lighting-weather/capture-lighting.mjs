import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? '.local/before';
const mobile = process.env.MOBILE === '1';
const width = mobile ? 390 : 1000;
const height = mobile ? 844 : 700;
const zoom = mobile ? 0.65 : 0.92;
const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
const page = await context.newPage();
page.on('console', (message) => console.log(`[browser ${message.type()}] ${message.text()}`));
page.on('pageerror', (error) => console.log(`[browser error] ${error.message}`));
await page.setViewportSize({ width, height });
await page.goto('http://127.0.0.1:5173/');
await page.waitForLoadState('domcontentloaded');
await page.evaluate(async () => {
  for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
  for (const key of await caches.keys()) await caches.delete(key);
});
await page.reload();
await page.waitForLoadState('domcontentloaded');
await mkdir(out, { recursive: true });
const result = await page.evaluate(async ({ only, width, height, zoom, mobile }) => {
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
  for (const [name, Renderer] of [['webgl2', WebGL2Renderer], ['canvas2d', Canvas2DRenderer]].filter(([name]) => !only || name === only)) {
    const canvas = document.createElement('canvas');
    canvas.id = `proof-${name}`;
    canvas.style.cssText = `position:fixed;inset:0;width:${width}px;height:${height}px;z-index:1000`;
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
      return renderers[name].canvas;
    },
    capture(name, condition) {
      this.frame(name, condition);
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
          renderers[name].canvas.getContext('2d').getImageData(0, 0, 1, 1);
        }
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      return { median: samples[Math.floor(samples.length / 2)], p95: samples[Math.floor(samples.length * .95)], count };
    },
  };
  window.__lightingProof = state;
  return { categories, map: [map.width, map.height], guests: snapshot.guests.count, rides: snapshot.rides.count, tracks: snapshot.tracks.count, pathLamps: mapData.pathCount };
}, { only: process.env.ONLY ?? null, width, height, zoom, mobile });
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
const timings = {};
for (const backend of process.env.ONLY ? [process.env.ONLY] : ['webgl2', 'canvas2d']) {
  for (const [label, condition] of selectedConditions) {
    await page.evaluate(([name, state]) => window.__lightingProof.capture(name, state), [backend, condition]);
    await page.waitForTimeout(60);
    await page.screenshot({ path: `${out}/${mobile ? 'mobile-' : ''}${backend}-${label}.png`, animations: 'disabled' });
    timings[`${backend}-${label}`] = await page.evaluate(([name, state]) => window.__lightingProof.benchmark(name, state, 50), [backend, condition]);
  }
}
console.log(JSON.stringify({ setup: result, timings }, null, 2));
await browser.close();
