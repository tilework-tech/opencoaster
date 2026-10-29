# Lighting and weather playability proof

> **Correction (v2).** The first version of this bundle shipped desktop WebGL2 "after" screenshots that showed only rain on a blank near-black scene, and its claim that all desktop WebGL proof had been reviewed was wrong. Cause and fix are in [DIAGNOSIS.md](DIAGNOSIS.md). The v1 images, benchmark and capture script are preserved under `superseded-v1/`, `render-benchmark.v1-invalid.json` and `capture-lighting.v1-superseded.mjs`. Everything outside those names is v2: every image and timing here passed the scene-present / context-alive gate.

This bundle contains visual before/after evidence, weather simulation measurements, renderer timing samples, and the capture scripts used for PR review.

## Findings

- Raising the full-night ambient tint from `[92, 106, 170]` to `[164, 178, 224]` preserves a cool night tone while making paths, terrain contours, the wooden coaster, guests, lamps and placement target readable without lighting every tile.
- Cloud, rain and storm washes are lighter (`0.16 → 0.08`, `0.21 → 0.10`, `0.40 → 0.18`). Rain streaks are unchanged. Daylight tint is unchanged.
- Across four climates, wet time fell from `49.16%` to `24.80%`; storm time fell from `24.60%` to `12.43%`. Wet spells now start `6.64` times/hour rather than `13.26`, while average wet spell length stays near `2m15s`; clear spells extend from `2m17s` to `6m42s`.
- Weather-state transitions remain about `39.92/hour` because the 60–120 second state duration range is unchanged. Climate still controls temperatures, not weather odds.
- The day/night cycle remains 36 in-game days (about 7m55s at 1x), with about 39.6 seconds each for dawn and dusk.

## Browser gallery

Open `index.html` and choose a renderer and condition. The desktop view puts the same 1000×700 scene before and after side by side. The mobile view shows rainy midnight at 390×844. Use the width slider to zoom the image.

The captured 48×48 inspection park contains 12 guests (small; not distinguishable in the desktop crops, visible only at the lower-left edge of the mobile crops), one operating wooden coaster with 14 track pieces, raised terrain, scenery, 19 path-lamp placements and a construction ghost. The capture loaded the `coaster-wood`, `people`, `vehicles` and `world` sprite categories. All five day/night/weather conditions were captured in both renderers, each backend in its own browser process. The Canvas2D view also shows the land-overlay tile grid that the WebGL view does not draw; that difference exists identically before and after. Every v2 image was inspected at readable size and shows terrain, paths, lamps, scenery and the coaster with the rain overlay on top.

## Measurements

`weather-metrics.json` aggregates 12 seeds × 1,000,000 ticks for each of Cold, CoolAndWet, HotAndDry and Warm climates. The simulation rate is 40 ticks/second (1x). Spell averages include the initial and trailing boundary fragments from each sampled run. Each run is long enough that these fragments have negligible effect on the reported incidence.

`render-benchmark.json` pools 2 rounds × 50 warmed frame samples per condition (100 per side) from paired baseline (`bd72461`, merge-base with main) and PR (`af9ac3f`) runs. Each run is one browser process with one renderer; runs never overlap; round 2 reverses the order of round 1 to expose drift. Each timed block is bracketed by a scene-present / context-alive check, and the summary refuses to read an invalid report. Chrome uses SwiftShader (software rendering), so absolute times (Canvas2D ≈ 24 ms, WebGL2 ≈ 48–59 ms) say nothing about GPUs.

Pooled median change, PR vs baseline: Canvas2D −1.7% to +1.7%, WebGL2 −1.9% to 0.0%. No median regression above ±2%. Pooled p95 from 100 samples is noisy (−23% to +13%, with no consistent direction) and is not used for any claim. Individual rounds differ by up to ±4% in median. No performance claim beyond "no measurable median change under software rendering" is supported; physical-GPU timing was not run.

The v1 timings (`render-benchmark.v1-invalid.json`) are withdrawn: they were taken in a single page with both renderers alive, and the v1 WebGL2 "after" samples were drawn while a Canvas2D canvas covered the scene.

## Verification

- `pnpm check`: passed — 229 test files, 2,247 tests; lint, format, typecheck and production build passed. Vite emitted its existing native-config extension warnings during tests/build.
- Focused night/weather readability test: passed on Canvas2D and WebGL2 (CI on `af9ac3f`; the product code is unchanged by this correction).
- Land preview/apply consistency test: passed on desktop and Pixel 8 after changing its baseline to compare the same live park before/after.
- The broader local quick browser selection produced 11 passes and 1 skip. Two existing Meadowbrook context-menu cases reproducibly ended with Chrome `Target crashed` in this SwiftShader runtime, including when run alone; those failures do not touch weather or lighting code.

## Reproduce

From the OpenCoaster repository root, run the app on port 5173 with the required sprite assets prepared, then:

```sh
BACKEND=webgl2 node playability-lighting-weather/capture-lighting.mjs /tmp/after   # one backend per process
BACKEND=canvas2d node playability-lighting-weather/capture-lighting.mjs /tmp/after
BASE_URL=http://127.0.0.1:5174/ BACKEND=webgl2 node playability-lighting-weather/capture-lighting.mjs /tmp/before   # baseline server
node playability-lighting-weather/summarize-benchmark.mjs <runsDir with r1/, r2/ each containing before/ and after/> out.json
pnpm exec tsx playability-lighting-weather/weather-metrics.ts
```

The script exits non-zero, and labels the output invalid, if any condition lacks the game world (too few distinct colours, no contrast, or nothing lit), if another element covers the canvas, if the WebGL context was lost, if required sprite pages are not loaded, or if the browser logged an error. `REPRODUCE_OVERLAP=1` re-creates the v1 bug as a negative control and must fail. Per-run reports with the measured scene statistics are in `reports/`.
