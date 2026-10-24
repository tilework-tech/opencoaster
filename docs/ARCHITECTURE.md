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

- After ticks run, the worker writes positions into a pooled `Snapshot` (4 Int32 per entity: x, y, z, state/variant) and transfers its `ArrayBuffer`s to the main thread (zero copy). The main thread returns the previous snapshot with a `recycle` message. If no buffer is free the worker skips publishing, which gives natural backpressure.
- Cost: ~16 B per entity, so 5000 guests ≈ 80 KB per snapshot; the copy-out loop is a tight typed-array loop (a few hundred µs at most).
- Why not SharedArrayBuffer: it requires cross-origin isolation (COOP/COEP), which static hosts like GitHub Pages cannot set, and shared mutable memory invites torn reads without extra synchronisation. The renderer only needs a consistent frame, which snapshots give for free.
- Headers: `vite.config.ts` serves COOP `same-origin` and COEP `require-corp` in dev/preview anyway, so a later SAB upgrade (e.g. a double-buffered shared position array with an atomic frame index) does not hit surprises. Nothing depends on them today; production hosting does not need to set them.
- Static data (terrain heights, corner slopes, surface class) is sent in a `map` message and re-sent whenever `TileMap.revision` changes, not per frame.
- Rendering uses the latest snapshot without interpolation for now. Interpolating between the last two snapshots is a planned renderer-side change that needs no protocol change.

## Rendering

`Renderer` interface (`src/render/renderer.ts`) with `WebGL2Renderer` as the primary backend and `Canvas2DRenderer` as a fallback. The WebGL2 path uses a runtime-generated procedural atlas and instanced quads fed from snapshot layers. Both renderers use the isometric 2:1 projection (64×32 px tiles), integer height levels, four view rotations via `rotateTile`/`unrotateTile`, and renderer-side viewport culling. The renderer reads only `Snapshot` and `MapData`; art remains procedural placeholder content.

The Playwright smoke run launches Chromium with SwiftShader, checks the game's active canvas and HUD report WebGL2, verifies there are no browser console or page errors, and writes a screenshot. A capability check on a separate canvas is not sufficient because startup can fall back to Canvas2D after a shader error.

## Performance budget

Target: **5000 guests at 40 ticks/s using < 8 ms of sim per tick** on a mid-range laptop (leaves 17 ms headroom per 25 ms tick for snapshotting, GC and a busy main thread). Strict benchmark mode enforces this limit at p99.

- Measure with `pnpm bench` (`--guests N --ticks N --strict`; `--strict` exits non-zero if p99 exceeds 8 ms). The benchmark warms up before timing individual `Simulation.step()` calls and uses nearest-rank percentiles; with 200 samples the p99 remains sensitive to individual slow ticks. It does not include worker snapshot copying or browser rendering.
- The runtime HUD shows EMA and max ms/tick and dropped ticks.
- Rules of thumb: no allocation in per-tick code; iterate columns, not objects; spread expensive work (pathfinding, decisions) across ticks keyed by entity id; cache and share paths.
- Guest updates are staggered across four ticks and reuse a path buffer. Re-profile these systems before changing their schedule or state-update order.

### Verification measurements (2026-10-24)

- Simulation benchmark on the Modal session runtime (Node 22.20.0), 5000 guests, 100 staff, 40 warmup ticks and 200 measured ticks: mean 0.260 ms/tick, p50 0.257 ms, p95 0.267 ms, p99 0.269 ms, max 0.276 ms. Strict p99 budget: pass (8 ms).
- Playwright headless Chromium 156 with SwiftShader at 1280×800 and 5000 guests: four runs collected 157–159 `renderer.draw` measurements each. Across runs, p50 was 0.58–0.60 ms, p95 1.41–1.63 ms, p99 1.90–2.10 ms, and max 2.31–4.14 ms. This measures the renderer's synchronous draw call, not the full browser frame or GPU hardware performance.
- SwiftShader confirms the WebGL2 startup and draw path work in headless Chromium. Its timings validate functionality and are not representative of a physical GPU.

## Save/load

`src/save` writes a versioned header (JSON) plus the raw typed-array columns (the map contributes everything in `TileMap.arrays()`). Loading rebuilds a `World` and continues bit-identically.
