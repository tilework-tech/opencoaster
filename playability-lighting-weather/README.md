# Lighting and weather playability proof

This bundle contains visual before/after evidence, weather simulation measurements, renderer timing samples, and the capture scripts used for PR review.

## Findings

- Raising the full-night ambient tint from `[92, 106, 170]` to `[164, 178, 224]` preserves a cool night tone while making paths, terrain contours, the wooden coaster, guests, lamps and placement target readable without lighting every tile.
- Cloud, rain and storm washes are lighter (`0.16 → 0.08`, `0.21 → 0.10`, `0.40 → 0.18`). Rain streaks are unchanged. Daylight tint is unchanged.
- Across four climates, wet time fell from `49.16%` to `24.80%`; storm time fell from `24.60%` to `12.43%`. Wet spells now start `6.64` times/hour rather than `13.26`, while average wet spell length stays near `2m15s`; clear spells extend from `2m17s` to `6m42s`.
- Weather-state transitions remain about `39.92/hour` because the 60–120 second state duration range is unchanged. Climate still controls temperatures, not weather odds.
- The day/night cycle remains 36 in-game days (about 7m55s at 1x), with about 39.6 seconds each for dawn and dusk.

## Browser gallery

Open `index.html` and choose a renderer and condition. The desktop view puts the same 1000×700 scene before and after side by side. The mobile view shows rainy midnight at 390×844. Use the width slider to zoom the image.

The captured 48×48 inspection park contains 12 guests, one operating wooden coaster with 14 track pieces, raised terrain, scenery, 19 path-lamp placements and a construction ghost. The capture loaded the `coaster-wood`, `people`, `vehicles` and `world` sprite categories. All five day/night/weather conditions were captured in both renderers. Images were inspected at full resolution.

## Measurements

`weather-metrics.json` aggregates 12 seeds × 1,000,000 ticks for each of Cold, CoolAndWet, HotAndDry and Warm climates. The simulation rate is 40 ticks/second (1x). Spell averages include the initial and trailing boundary fragments from each sampled run. Each run is long enough that these fragments have negligible effect on the reported incidence.

`render-benchmark.json` records 50 warmed frame samples per condition in Chrome with SwiftShader, with a synchronous 1-pixel readback per sample. This is a software-rendered comparison, not a physical-GPU benchmark. Median frame-time changes range from **−6.66% to +2.67%** across conditions. The p95 samples are noisy: Canvas2D clear-night had a +14.32% p95 outlier on this run, while a prior same-method after run measured that p95 lower than baseline. The median results show no consistent renderer regression; use physical-GPU timing for hardware-specific conclusions.

## Verification

- `pnpm check`: passed — 229 test files, 2,247 tests; lint, format, typecheck and production build passed. Vite emitted its existing native-config extension warnings during tests/build.
- Focused night/weather readability test: passed on Canvas2D and WebGL2.
- Land preview/apply consistency test: passed on desktop and Pixel 8 after changing its baseline to compare the same live park before/after.
- The broader local quick browser selection produced 11 passes and 1 skip. Two existing Meadowbrook context-menu cases reproducibly ended with Chrome `Target crashed` in this SwiftShader runtime, including when run alone; those failures do not touch weather or lighting code.

## Reproduce

From the OpenCoaster repository root, run the app on port 5173 with the required sprite assets prepared, then:

```sh
node playability-lighting-weather/capture-lighting.mjs /tmp/opencoaster-after
pnpm exec tsx playability-lighting-weather/weather-metrics.ts
```

The capture script writes screenshots and benchmark JSON to the requested output directory. Source-before measurements remain documented in `render-benchmark.json` and `weather-metrics.json`.
