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

`Renderer` interface (`src/render/renderer.ts`) with `WebGL2Renderer` as the primary backend and `Canvas2DRenderer` as a fallback. The WebGL2 path uses a runtime-generated procedural atlas and instanced quads fed from snapshot layers. Both renderers use the isometric 2:1 projection (64×32 px tiles), integer height levels, four view rotations via `rotateTile`/`unrotateTile`, and renderer-side viewport culling. The renderer reads only `Snapshot` and `MapData`; art remains procedural placeholder content.

The Playwright smoke run launches Chromium with SwiftShader, checks the game's active canvas and HUD report WebGL2, exercises the Rides window, verifies there are no browser console or page errors, and writes a screenshot. A capability check on a separate canvas is not sufficient because startup can fall back to Canvas2D after a shader error.

## Browser input and mobile runtime

The browser main thread owns UI, pointer gestures, camera state, rendering, and the simulation command bridge. [src/input](../src/input/docs.md) recognizes taps, drags, holds, pinch scale, and twist; [src/main.ts](../src/main.ts) maps those intents through the existing projection/picking and UI command path. Forced holds use [object-picking.ts](../src/input/object-picking.ts) to resolve ride footprints and track tiles to ride IDs from the latest snapshot; guest details use the existing guest hit-test, and other tiles remain tile selections. This keeps touch placement subject to the same map bounds and worker-side validation as desktop placement. Pointer and projection coordinates use CSS pixels, while canvas and track-preview backing buffers use a device-pixel ratio capped at 2.

The app shell uses a cover viewport and safe-area CSS offsets, resizes from canvas bounds and viewport/orientation changes, and pauses the worker while the document is hidden. [src/pwa](../src/pwa/docs.md) registers the root-scoped service worker and caches the app shell and same-origin resources for offline startup after an online install/load. Service-worker caches contain app assets; save data stays in the save subsystem.

Playwright's iPhone 15 and Pixel 8 profiles use Chromium DevTools touch injection to exercise touch-driven path placement, pan, pinch zoom, rotation controls, guest-window access, viewport behavior, and offline reload. This is Chromium emulation, not WebKit/Safari or physical-device testing. The final post-rebase mobile FPS case ran headless Chromium with SwiftShader using Pixel 8 viewport emulation and 2,000 guests; it collected 100 HUD FPS samples with p50 23, p95 41, p99 47, and max 48 FPS. In the strict 5,000-guest simulation benchmark, p99 was 2.333 ms/tick; the WebGL2 smoke run collected 115 frames with p50 1.84 ms, p95 2.74 ms, p99 3.20 ms, and max 4.39 ms. Smoke frame timing is browser-emulated and is not directly comparable to simulation-tick timing.

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

## Save/load

`src/save` writes a versioned header (JSON) plus the raw typed-array columns (the map contributes everything in `TileMap.arrays()`). Loading rebuilds a `World` and continues bit-identically. Save version 8 adds per-ride gross receipt counters; version 10 adds guest navigation columns and research work units; version 11 adds fine-grained ride reliability, ride mode and mechanic-work columns. Older saves migrate with defaults, and version-10 guest navigation and research data are preserved when rides are upgraded.
