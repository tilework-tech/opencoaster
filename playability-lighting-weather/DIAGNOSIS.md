# Blank desktop WebGL2 "after" screenshots

## Symptom

In v1, all five `after/webgl2-*.png` files showed either a near-black blank frame (clear-day/clear-night, 3.6 KB) or only rain streaks on near-black (rainy/storm, 17–18 KB). The matching `before/webgl2-*.png` files (160–340 KB) and the mobile WebGL2 image showed the full park.

## Cause: harness, not product

`capture-lighting.mjs` v1 created both renderers in one page, each on its own `position:fixed; inset:0; z-index:1000` canvas. The Canvas2D canvas is appended second, so it sat on top of the WebGL2 canvas for the whole run. When the WebGL2 backend was captured, the screenshot showed the Canvas2D canvas (never drawn in that step) plus the DOM rain overlay.

Evidence, reproduced on PR head `af9ac3f`:

- v1 script with both renderers: `webgl2-clear-day.png` is 3,599 bytes, the same size as the published blank. With only WebGL2 instantiated (`ONLY=webgl2`): 163,791 bytes, the same size as the published `before` frame.
- `document.elementsFromPoint(500, 350)` with both renderers: `['proof-canvas2d', 'proof-webgl2', …]`.
- `gl.isContextLost()` was `false` and no `webglcontextlost` event fired. In the negative-control run the WebGL canvas read back as a full scene (read-back check passed) while the screenshot check failed, so the context was alive and rendering underneath the cover.
- No console or page errors in any run.
- The PR's product code (`src/render/**`, tint 92,106,170 → 164,178,224) renders a complete scene in WebGL2 in all five conditions once the cover is removed.

Not a lost context, not a sprite-loading failure, not a renderer regression. The v1 "before" WebGL set was apparently captured with a single renderer (not recorded), so before/after were not captured under the same harness conditions.

## Fixes

- One backend per browser process; the other renderer is never created.
- Gates on every condition (any failure → exit 1, no pass): scene stats from a canvas read-back and from the screenshot itself (≥150 distinct colours, luma stddev ≥6, ≥2% lit pixels; measured valid range is ≥336 colours, stddev ≥16.2, lit ≥18%; the reproduced v1-style blank rain-only frame has 22 colours), topmost non-overlay element at the centre is the proof canvas, WebGL context alive with no loss event, all four sprite categories loaded, no console error or page error. The same checks run again after the timing loop.
- Negative control `REPRODUCE_OVERLAP=1` fails with `canvas covered by #proof-canvas2d` and `only 22 distinct colours`.

## Timing audit

Every v1 sample (all 20 before/after × renderer × condition blocks) shares the invalid setup: one page, both renderers alive, and for WebGL2 "after" a covered, not-visible scene. v1 WebGL2 medians (91–114 ms) are about twice the valid v2 values (48–59 ms), consistent with the extra resident renderer. All v1 timings are withdrawn; `render-benchmark.json` is a new paired measurement.
