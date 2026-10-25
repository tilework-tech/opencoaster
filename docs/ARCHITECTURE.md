# Architecture

## Overview

```
 main thread                               worker (sim.worker.ts)
 ┌────────────────────────┐   commands    ┌───────────────────────────┐
 │ UI / input             │ ───────────▶  │ SimRunner                 │
 │ Renderer (Canvas2D→GL) │               │  FixedStepScheduler       │
 │ SimClient              │ ◀───────────  │  Simulation.step() ×N     │
 └────────────────────────┘  snapshots,   │   World + systems         │
                             stats, map   └───────────────────────────┘
```

The simulation owns all game state and runs in a Web Worker. The main thread renders and handles input; it never reads or writes sim state directly.

## Tick loop

- 40 ticks per second (`TICK_RATE`), fixed step, 25 ms per tick at 1x speed.
- The worker polls a timer; `FixedStepScheduler` converts elapsed wall time to a whole number of ticks (speed multiplier, pause, catch-up cap of 8 ticks). Timer jitter changes _when_ ticks run, never _what_ they compute.
- If the sim falls behind past the cap, ticks are dropped and counted (`droppedTicks` in stats) instead of spiralling.
- `Simulation.step()`: apply queued commands, run `SYSTEM_ORDER` in fixed order, increment `tick`.

## Determinism

Same seed + same ordered commands ⇒ bit-identical state, on every machine.

- All randomness comes from `Prng` (sfc32, 32-bit integer ops via `Math.imul`).
- Stored state is integers only (typed arrays, no Float32/64). Positions are fixed-point: `TILE_UNITS` = 256 per tile, `Z_STEP` = 64 per height level. Money is integer cents.
- No clock or `Math.random` in `src/sim` (ESLint `no-restricted-properties`).
- Commands apply at tick boundaries in arrival order; a replay is `(seed, [(tick, command)])`.
- `hashWorld` hashes all live state; tests assert equal hashes for equal runs and for save→load→continue.
- Avoid `Map`/`Set` iteration in hot sim paths (`ResearchState.unlocked` is cold).

## Entity storage

`EntityStore` is struct-of-arrays: one typed array per field, entities densely packed in slots `[0, count)`. Despawn swap-removes the last entity into the hole. Stable ids map to slots via `idToSlot`; cross-entity references store ids. Stores exist for guests, staff, vehicles, litter and rides. Capacities are fixed at construction, so there is no allocation or GC pressure in steady state.

## Worker transport: transferable snapshots (chosen) vs SharedArrayBuffer

Chosen: **transferable snapshot buffers**, three pooled per run.

- After ticks run, the worker writes positions into a pooled `Snapshot` (4 Int32 per entity: x, y, z, state/variant), guest details (12 Int32 per guest: needs, cash, and thought history), a 22-Int32-per-ride `rideInfo` table, and latest command `feedback`, then transfers its `ArrayBuffer`s to the main thread (zero copy). The main thread returns the previous snapshot with a `recycle` message. If no buffer is free the worker skips publishing, which gives natural backpressure.
- Snapshot storage is 64 B per guest (16 B render layer plus 48 B details), plus staff, litter, vehicle, ride, and feedback arrays. At 5000 guests, guest data alone is about 320 KB per snapshot; map data is sent separately when the map revision changes.
- Why not SharedArrayBuffer: it requires cross-origin isolation (COOP/COEP), which static hosts like GitHub Pages cannot set, and shared mutable memory invites torn reads without extra synchronisation. The renderer only needs a consistent frame, which snapshots give for free.
- Headers: `vite.config.ts` serves COOP `same-origin` and COEP `require-corp` in dev/preview anyway, so a later SAB upgrade (e.g. a double-buffered shared position array with an atomic frame index) does not hit surprises. Nothing depends on them today; production hosting does not need to set them.
- Static data (terrain heights, corner slopes, surface class, water levels, and path element stacks for elevation, queues, and accessories) is sent in a `map` message and re-sent whenever `TileMap.revision` changes, not per frame.
- Rendering uses the latest snapshot without interpolation for now. Interpolating between the last two snapshots is a planned renderer-side change that needs no protocol change.

## Rendering

`Renderer` interface (`src/render/renderer.ts`) with `WebGL2Renderer` as the primary backend and `Canvas2DRenderer` as a fallback. The WebGL2 path loads the generated world-art atlas pages (eager world/people pages at start, ride and track pages on first use) and draws instanced quads fed from snapshot layers; a small procedural atlas supplies missing-sprite fallback cells. Both renderers use the isometric 2:1 projection (64×32 px tiles), integer height levels, four view rotations via `rotateTile`/`unrotateTile`, and renderer-side viewport culling. The renderer reads only `Snapshot` and `MapData`; the DOM UI loads its separate generated icon sheet.

The WebGL2 frame is built in layers so per-frame cost tracks what actually changes:

- **Ground cache.** Terrain surfaces, sloped corners, boundary cliff faces and flat path fill are painted once into 512×512 world-pixel textures (one texel per world pixel, rotation-specific) by running the normal instanced shader at zoom 1, and drawn as a handful of textured quads each frame. Chunks render lazily for the visible area into a shared framebuffer, live in an LRU cache sized to the visible chunk count, and are invalidated only for tiles whose height, surface, slope or water level changed when a new `MapData` arrives (everything on rotation, gridline toggle or atlas swap).
- **Occluders.** Ground is painted beneath every sprite, so each frame also re-submits, in the depth-sorted pass, the visible terrain tiles that rise above the tiles behind them (found once per `(map, rotation)`). Raised terrain in front of guests, scenery and water therefore still hides them; flat ground never needs the extra draw.
- **Per-frame water.** Water planes stay in the sorted pass (shader-clipped against their tile's corners), cached as a list per `(map, rotation)`.
- **Dynamic sprites.** Guests, staff, litter, vehicles and rides are culled before they are appended, merged with the static entries, depth-sorted with an allocation-free counting sort (`painter-order.ts`) and uploaded with `bufferSubData`.
- **Adaptive resolution.** `AdaptiveResolution` scales the backing-buffer DPR (1 → 0.3 of the capped DPR) when frames stay slow and cautiously restores it after sustained on-budget frames, backing off when a restored scale proves too slow. A drop that does not speed up a steady frame cadence (a display capped below 60 Hz) is undone and further drops are suspended for a minute. Pointer and picking math stay in CSS pixels.
- **Snapshot rate.** The main thread tells the worker (`setSnapshotInterval`) not to publish snapshots faster than frames are drawn, so slow displays skip snapshot writes and transfers; the simulation keeps its fixed tick regardless.
- **UI cost.** HUD text refreshes at 20 Hz, management panels at 10 Hz, the canvas rectangle is cached instead of read every frame, and the track preview canvas is hidden while idle.

The Playwright smoke run launches Chromium with SwiftShader, checks the game's active canvas and HUD report WebGL2, exercises the Rides window, verifies there are no browser console or page errors, and writes a screenshot. A capability check on a separate canvas is not sufficient because startup can fall back to Canvas2D after a shader error. It also runs the mobile frame-rate cases described under [Performance budget](#frame-loop-performance-2026-10-25).

## Browser input and mobile runtime

The browser main thread owns UI, pointer gestures, camera state, rendering, and the simulation command bridge. The thin [src/main.ts](../src/main.ts) entry point awaits [bootstrap](../src/app/bootstrap/docs.md), which assembles the renderer, UI, worker client, and app controllers. [Camera input](../src/app/input/docs.md) recognizes gestures and routes them through callbacks; [tool handling](../src/app/tools/docs.md) performs tile picking and sends existing simulation commands; [ride setup](../src/app/ride-setup/docs.md) coordinates multi-step ride placement; and [save/load](../src/app/save-load/docs.md) owns session and persistence flows. These controllers receive app dependencies through callbacks, keeping browser orchestration on the main thread and simulation authority in the worker. Forced holds resolve guests and ride footprints from the latest snapshot. Pointer and projection coordinates use CSS pixels, while canvas and track-preview backing buffers use a device-pixel ratio capped at 2.

The app shell uses a cover viewport and safe-area CSS offsets, resizes from canvas bounds and viewport/orientation changes, and pauses the worker while the document is hidden. [src/pwa](../src/pwa/docs.md) registers a service worker scoped to the deploy base (origin root in dev, `/opencoaster/` on GitHub Pages) and caches the app shell and same-origin resources for offline startup after an online install/load. Service-worker caches contain app assets; save data stays in the save subsystem.

Playwright's iPhone 15 and Pixel 8 profiles use Chromium DevTools touch injection to exercise touch-driven path placement, pan, pinch zoom, rotation controls, guest-window access, viewport behavior, and offline reload. This is Chromium emulation, not WebKit/Safari or physical-device testing. Mobile frame rate is measured by `pnpm smoke` (see [Frame-loop performance](#frame-loop-performance-2026-10-25)); the e2e Pixel 8 case only records HUD FPS samples. The final strict 5,000-guest simulation benchmark passed with p99 1.683 ms/tick. Smoke frame timing is browser-emulated and is not directly comparable to simulation-tick timing or physical hardware performance.

## Performance budget

Target: **5000 guests at 40 ticks/s using at most 3 ms of sim per tick at p99** in the benchmark workload (5,000 guests, 100 mixed staff, and 1,000 litter items). This leaves headroom within the 25 ms fixed tick for snapshotting, rendering, and other runtime work. Strict benchmark mode enforces the 3 ms p99 limit; the performance work's optimization goal is at most 2 ms, which the strict benchmark does not enforce.

- Measure with `pnpm bench` (`--guests N --staff N --litter N --ticks N --warmup N --strict`; `--strict` exits non-zero if p99 exceeds 3 ms). Defaults are 5,000 guests, 100 staff, 1,000 litter, 400 measured ticks, and 40 warmup ticks. The staff mix is 60% handymen, 10% mechanics, 10% security, and 20% entertainers; the seeded map includes a path lattice and full bins. The benchmark times individual `Simulation.step()` calls and uses nearest-rank percentiles, so short samples remain sensitive to a few slow ticks. It does not include worker snapshot copying or browser rendering.
- The runtime HUD shows EMA and max ms/tick and dropped ticks.
- Rules of thumb: avoid per-tick allocation; iterate columns, not objects; spread staff decisions across ticks by stable entity id; cache map-derived data and use tile indexes for local litter and guest lookups.
- Guest updates are staggered across four ticks and reuse a path buffer. Re-profile these systems before changing their schedule or state-update order.

### Verification measurements (2026-10-24)

- The staff and litter performance change was profiled with a realistic mixed roster. On the same seeded scenario (5,000 guests, 100 staff, 1,000 initial litter), 400 measured ticks after 40 warmup ticks reported p99 of 2.524 ms before and 1.403 ms after, a 44.4% reduction. The strict default command with 200 measured ticks and 40 warmup ticks reported p99 of 2.920 ms and passed the 3 ms budget; that short run does not establish the separate 2 ms optimization goal.
- CPU profiles over 1,000 ticks sampled `updateGuest` 64 times, `bfsFirstDir` 57, generic `update` 51, `moveAlongHeading` 42, `ageNeeds` 25, `moveStaff` 7, and garbage collection 11 before the change. Afterward they sampled `updateGuest` 70, generic `update` 71, `bfsFirstDir` 43, `moveAlongHeading` 31, `buildGuestIndex` 24, `moveStaff` 13, and garbage collection 9. These are sample counts, not precise timing attribution; Node and tsx loader overhead is included.
- Playwright headless Chromium 156 with SwiftShader at 1280×800 and 5000 guests: five runs collected 157–159 `renderer.draw` measurements each. Across runs, p50 was 0.58–0.60 ms, p95 1.00–1.63 ms, p99 1.90–2.10 ms, and max 2.00–4.14 ms. This measures the renderer's synchronous draw call, not the full browser frame or GPU hardware performance.
- SwiftShader confirms the WebGL2 startup and draw path work in headless Chromium. Its timings validate functionality and are not representative of a physical GPU.
- Final Wave 4 verification against rebased `main` on the same Modal runtime: strict benchmark, 5000 guests, 100 staff, and 1498 litter over 200 ticks, p99 2.094 ms/tick versus 1.929 ms/tick on `main`; both passed the current 3 ms p99 budget. Playwright with 5000 guests collected 127 frame-HUD samples; p50 1.33 ms, p95 1.91 ms, p99 2.83 ms, max 2.93 ms, versus baseline p50 0.57 ms, p95 0.98 ms, p99 1.57 ms, max 1.73 ms. Smoke frame timings include more than the synchronous renderer draw call, so they are not directly comparable to the earlier renderer-only measurements above. These are single-run samples and can vary with runtime load.

### Frame-loop performance (2026-10-25)

`pnpm smoke` runs [smoke/mobile-fps.spec.ts](../smoke/mobile-fps.spec.ts): Pixel 8 profile, Chromium CPU throttling 4×, device scale factor 2.6 (the renderer caps DPR at 2 before adaptive scaling), 2,000 and 5,000 guests, 8 s warm-up for adaptive resolution to settle, then 6 s of `requestAnimationFrame` intervals. It prints median FPS, p95 frame time and the final render scale, and records a `soft-budget-miss` annotation (never a failure) when the median is below 55 FPS at 2,000 guests or 30 FPS at 5,000.

Profiling the baseline (headless Chromium 156, SwiftShader, single vCPU) showed the renderer main thread mostly idle and the GPU process about 98% busy; skipping terrain alone took mobile emulation from 8.6 to 30 FPS, while guests were nearly free (2,000 and 5,000 guests measured the same). Per-frame terrain quads, full-screen fill and compositing were the cost, not JavaScript.

| Scenario (rAF intervals, 6 s, 8–9 s warm-up) | Before median / mean FPS | After median / mean FPS |
| -------------------------------------------- | ------------------------ | ----------------------- |
| Desktop 1280×800, 2,000 guests               | 12 / 12.6                | 60 / 41.9               |
| Desktop 1280×800, 5,000 guests               | 12 / 11.6                | 30 / 38.1               |
| Mobile emulation, 2,000 guests               | 8.6 / 8.6                | 60 / 44.2               |
| Mobile emulation, 5,000 guests               | 8.6 / 8.2                | 60 / 39.4               |

"Before" is `main` at 1d8a847; "after" is this change. Median FPS is quantised to vsync multiples (60, 30, 20, …) and the after-runs are bimodal around 16.7 and 33 ms frames, so the mean is the more conservative figure; `pnpm smoke` runs of the mobile cases gave a 60 FPS median at 2,000 guests every time (6 of 6) and 30–60 at 5,000. Under this emulation adaptive resolution settles at its 0.3× floor, so the speedup is partly bought with resolution; on hardware that holds 60 FPS the scale stays at 1×. The headless SwiftShader harness is a pessimistic proxy for a physical phone GPU.

## Save/load

`src/save` writes a versioned header (JSON) plus the raw typed-array columns (the map contributes everything in `TileMap.arrays()`). Loading rebuilds a `World` and continues bit-identically. Save version 8 adds per-ride gross receipt counters; version 10 adds guest navigation columns and research work units; version 11 adds fine-grained ride reliability, ride mode and mechanic-work columns. Older saves migrate with defaults, and version-10 guest navigation and research data are preserved when rides are upgraded.
