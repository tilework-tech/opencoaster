import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './support/test';

/**
 * Registers a test scoring the renderers' per-pixel object ownership against the occlusion oracle
 * (src/render/occlusion-oracle.ts) on fuzzed parks: every seed, rotation and zoom renders
 * `/occlusion-fixture.html`, captures the renderer's object-ID image and compares it with the
 * oracle's z-buffer over the same placed sprites and terrain. Writes a JSON report (and, with
 * OCCLUSION_IMAGES=1, id and heat-map PNGs) to `.local/occlusion/`. The OCCLUSION_* environment
 * variables override the caller's seeds, zooms and renderers.
 */

interface PairScore {
  mismatched: number;
  contested: number;
}

interface Score {
  objectPixels: number;
  ambiguous: number;
  mismatched: number;
  coverage: number;
  pairs: Record<string, PairScore>;
  rendered?: string;
  oracle?: string;
  heat?: string;
}

const ROTATIONS = [0, 1, 2, 3];
const RENDERERS = (process.env.OCCLUSION_RENDERERS ?? 'webgl2,canvas2d').split(',');
const IMAGES = process.env.OCCLUSION_IMAGES === '1';
const OUT = join('.local', 'occlusion', process.env.OCCLUSION_LABEL ?? 'current');
/** Acceptance: overall mismatch share of object pixels, and per kind pair of contested pixels. */
const MAX_MISMATCH = Number(process.env.OCCLUSION_MAX ?? 0.005);
const MAX_PAIR = Number(process.env.OCCLUSION_MAX_PAIR ?? 0.02);
/**
 * Per-pair ceilings tighter than MAX_PAIR. `support>land-overlay` is a depth tie at support bases
 * (the overlay is part of the ground, so a support standing on the surface must win it); a
 * regression to the overlay winning that tie lifts it above 2%.
 */
const MAX_PAIR_BASELINES: Record<string, number> = {
  'ground>track': 0.00065,
  'support>land-overlay': 0.002,
};
/** Pairs need this many contested pixels before their rate is judged. */
const MIN_CONTESTED = 200;

export function occlusionOracleTest(defaults: { seeds: string; zooms: string }): void {
  const SEEDS = (process.env.OCCLUSION_SEEDS ?? defaults.seeds).split(',').map(Number);
  const ZOOMS = (process.env.OCCLUSION_ZOOMS ?? defaults.zooms).split(',').map(Number);
  test.setTimeout(20 * 60_000);
  test('renderer object ownership matches the occlusion oracle on fuzzed parks', async ({
    browser,
  }) => {
    await mkdir(OUT, { recursive: true });
    const totals = { objectPixels: 0, ambiguous: 0, mismatched: 0, coverage: 0 };
    const pairs: Record<string, PairScore> = {};
    const cases: Record<string, Omit<Score, 'rendered' | 'oracle' | 'heat'>> = {};
    const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
    for (const renderer of RENDERERS)
      for (const seed of SEEDS)
        for (const rot of ROTATIONS)
          for (const zoom of ZOOMS) {
            const page = await context.newPage();
            await page.goto(
              `/occlusion-fixture.html?seed=${seed}&rot=${rot}&zoom=${zoom}&renderer=${renderer}`,
            );
            await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready, {
              timeout: 120_000,
            });
            const score = await page.evaluate(
              (images) => (window as unknown as { __score(i: boolean): Score }).__score(images),
              IMAGES,
            );
            const name = `${renderer}-seed${seed}-rot${rot}-zoom${zoom}`;
            if (IMAGES)
              for (const kind of ['rendered', 'oracle', 'heat'] as const)
                await writeFile(
                  join(OUT, `${name}-${kind}.png`),
                  Buffer.from(score[kind]!.split(',')[1]!, 'base64'),
                );
            const numbers = {
              objectPixels: score.objectPixels,
              mismatched: score.mismatched,
              coverage: score.coverage,
              pairs: score.pairs,
            };
            cases[name] = numbers;
            totals.objectPixels += score.objectPixels;
            totals.ambiguous += score.ambiguous;
            totals.mismatched += score.mismatched;
            totals.coverage += score.coverage;
            for (const [key, pair] of Object.entries(score.pairs)) {
              const sum = (pairs[key] ??= { mismatched: 0, contested: 0 });
              sum.mismatched += pair.mismatched;
              sum.contested += pair.contested;
            }
            await page.close();
          }
    await context.close();
    const rate = totals.mismatched / Math.max(1, totals.objectPixels);
    const pairRates = Object.fromEntries(
      Object.entries(pairs)
        .map(([key, p]) => [key, { ...p, rate: p.mismatched / Math.max(1, p.contested) }] as const)
        .sort((a, b) => b[1].mismatched - a[1].mismatched),
    );
    await writeFile(
      join(OUT, 'report.json'),
      `${JSON.stringify({ totals: { ...totals, rate }, pairs: pairRates, cases }, null, 2)}\n`,
    );
    console.log(
      `occlusion: ${(rate * 100).toFixed(3)}% of ${totals.objectPixels} object pixels mismatched; ` +
        `${totals.coverage} coverage-only; ${totals.ambiguous} ambiguous edge samples left out`,
    );
    for (const [key, p] of Object.entries(pairRates).slice(0, 15))
      console.log(`  ${key}: ${p.mismatched}/${p.contested} (${(p.rate * 100).toFixed(2)}%)`);
    if (process.env.OCCLUSION_REPORT_ONLY === '1') return;
    expect(rate).toBeLessThanOrEqual(MAX_MISMATCH);
    expect(totals.coverage / Math.max(1, totals.objectPixels), 'coverage-only').toBeLessThanOrEqual(
      MAX_MISMATCH,
    );
    for (const [key, p] of Object.entries(pairRates))
      if (p.contested >= MIN_CONTESTED)
        expect(p.rate, key).toBeLessThanOrEqual(MAX_PAIR_BASELINES[key] ?? MAX_PAIR);
  });
}
