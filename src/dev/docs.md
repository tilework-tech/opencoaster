# Noridoc: Dev fixtures

Path: @/src/dev

### Overview

- Dev-only pages and generators for checking rendering behaviour in a real browser; they are served only by `pnpm dev` and are not part of the production build.
- [depth-fixture.ts](depth-fixture.ts), loaded by [depth-fixture.html](../../depth-fixture.html), draws one hand-built 16×16 map and a single guest or staff member through either renderer, for targeted pixel-ownership checks.
- [occlusion-fixture.ts](occlusion-fixture.ts), loaded by [occlusion-fixture.html](../../occlusion-fixture.html), renders a seeded fuzz park from [occlusion-fuzz.ts](occlusion-fuzz.ts) and scores the renderer against the occlusion oracle ([src/render/docs.md](../render/docs.md), "Occlusion model").

### How it fits into the larger codebase

- [e2e/people-depth.spec.ts](../../e2e/people-depth.spec.ts) drives the depth fixture; [e2e/occlusion-oracle.spec.ts](../../e2e/occlusion-oracle.spec.ts) drives the occlusion fixture across renderers, seeds, rotations and zooms.
- The fuzz park is built through real simulation commands and the worker's own `extractMapData` / snapshot writers, so the renderers receive exactly what the worker would publish. It runs in Node (unit tests in [occlusion-fuzz.test.ts](occlusion-fuzz.test.ts)) and on the browser main thread.
- The occlusion fixture uses the renderers' `captureObjectIds`, [occlusion-oracle.ts](../render/occlusion-oracle.ts), [oracle-terrain.ts](../render/oracle-terrain.ts) and [occlusion-metric.ts](../render/occlusion-metric.ts) from [src/render](../render/docs.md).

### Core Implementation

- Depth fixture query parameters: `renderer=webgl2|canvas2d`, `rot=0..3`, `scene` (a named hand-built scene, e.g. `blank`, `path-queue`, `path-slope`, `tree-on-path-side`, `stall`; see the scene table in the source), `actor=guest|staff|none`, `gx`/`gy`/`gz` (tile units and levels, fractional), `dir`, `zoom`, `w`/`h`/`dpr`, and `focus=x,y,z` for a fixed camera. It sets `window.__ready` once redraws stop changing the canvas; `window.__show(guest | null, focus)` redraws with the guest moved or removed and the camera re-centred, and `window.__move(x, y, z)` moves the guest.
- `buildFuzzPark(seed)` lays out a dense park deterministically from a seeded PRNG: terrain including slopes and terraces, paths and queues, path additions, scenery and walls, flat and multi-tile rides, a coaster tested so it has supports and vehicles, stalls, the park gate, ride entrances and exits, and guests, staff and litter at sub-tile positions. It returns the map data, snapshot and a camera focus point.
- Occlusion fixture query parameters: `seed`, `rot`, `zoom`, `w`/`h`, `renderer=webgl2|canvas2d`, and `painter=1`, which disables the Canvas2D depth composite so its cost can be compared. After lazy sprite categories settle it sets `window.__ready` and exposes `window.__score(images)` (oracle score; with `images`, rendered, oracle and heat-map PNG data URLs) and `window.__time(frames)` (median and worst draw time).

### Things to Know

- Depth fixture terrain is dirt so generated ambient trees do not appear; slope pieces use the same flags and base levels as `MapData.pathElements`.
- The oracle is built from the sprites the renderer reports placing, so the score measures ordering against a joint z-buffer of those placements; for Canvas2D it mostly validates capture and placement, because its composite uses the oracle's algorithm.

Created and maintained by Nori.
