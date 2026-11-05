// Times CacheStorage.delete of a cache shaped like the old build's (24,918 entries) in Chromium.
import { chromium } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'oc-cd-')));
const page = ctx.pages()[0];
await page.route('http://127.0.0.1:4999/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: 'x' }));
await page.goto('http://127.0.0.1:4999/');
const result = await page.evaluate(async () => {
  const cache = await caches.open('opencoaster-static-old');
  const body = new Uint8Array(5000);
  let t = performance.now();
  for (let i = 0; i < 24918; i += 500)
    await Promise.all(Array.from({ length: 500 }, (_, j) => cache.put(`/sprites/rides/${i + j}.png`, new Response(body))));
  const fill = performance.now() - t;
  t = performance.now();
  await caches.match('/sprites/rides/123.png');
  const match = performance.now() - t;
  t = performance.now();
  await caches.delete('opencoaster-static-old');
  return { fillMs: Math.round(fill), matchMs: Math.round(match), deleteMs: Math.round(performance.now() - t) };
});
console.log(JSON.stringify(result));
await ctx.close();
