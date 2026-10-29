# PR #185 proof: Observation Tower variable height and travel

Browser evidence captured with Playwright (software WebGL2 / Canvas2D) against the dev build.

- `before-cycle-1x.webm`, `before-timing.json`: previous build, one full cycle at 1x with on-screen sim clock.
- `after-medium-cycle-1x.webm`, `after-medium-timing.json`: new 16-level tower, test run, opening with 1,000 guests, one full cycle at 1x.
- `webgl2-built-framed.png`, `built-short-medium-tall.png`: 8 / 16 / 26-level towers built through the build controls.
- `webgl2-test-run-cabin-ascending-rotation-{0..3}.png`, `webgl2-test-run-cabin-at-top.png`, `webgl2-riders-cabin-aloft.png`: all four view rotations, cabin aloft, riders queued (WebGL2).
- `canvas2d-paused-cabin-aloft-rotation-{0..3}.png`: same in Canvas2D (paused with the cabin aloft).
- `height-edit.png`: ride-window height edit; `mobile-height-control.png`: Pixel 8 build control.
- `webgl2-timing-summary.json`, `webgl2-samples.json`, `tower-test-run-samples.json`: per-frame samples and derived timings (phase ticks, cabin speed, reversals, 1x/2x/4x/pause probe).
- `scripts/`: the specs and helpers that produced them (`TOWER_PROOF_DIR=<dir> pnpm exec playwright test --config=playwright.e2e.config.ts e2e/observation-tower-proof.spec.ts`; the baseline spec runs from a checkout of the previous main with `TOWER_BASELINE=1`, a stub `observation-tower.ts` and a config pointing at its dev server).

Timing at 1x: before 80/399/78 ticks (load/run/unload); new 8 levels 433 run, 16 levels 1057, 26 levels 1837 (+ 120 load/unload). Cabin speed 1/38.8 level per tick, one climb, one descent. 2x measured 79 ticks/s, 4x 160, paused 0.
