# Noridoc: Smoke

Path: @/smoke

### Overview

- This folder contains the browser smoke suite for renderer integration, starter-park visuals and UI behavior.
- `pnpm smoke` runs the WebGL2 integration check with a 5,000-guest park and a terrain visual check against the Vite dev server.
- `pnpm smoke:subpath` builds `dist/`, serves it under `/opencoaster/` without cross-origin isolation headers, and runs the same suite plus `deployed-base.spec.ts`, which checks the manifest, icons, sprite manifest and eager atlas page, precached atlas pages (production build), and service-worker scope resolve under the deploy base.

### How it fits into the larger codebase

- Playwright drives the Vite app through its browser UI and checks the canvas renderer, performance HUD, and console for browser errors. The starter-park terrain check captures the WebGL canvas, checks for dark gaps and connected lake water, compares gridline-off/on frames, and verifies path-surface and scenery controls.
- The UI icon smoke spec opens toolbar-accessible windows and checks that each rendered tab strip has unique icon IDs. Source-level tab-set coverage lives with the UI window definitions.
- The longer Starter Park playtest lives in [e2e](../e2e/docs.md) and runs separately with `pnpm e2e`.
- The shared [Playwright configuration](../playwright.config.ts) runs browser checks one worker at a time and retains a trace when a test fails.

### Things to Know

- The smoke test adds 5,000 guests, pauses at the game menu, then waits for the displayed simulation tick to advance after resuming before sampling frames. This synchronizes the check with simulation progress rather than a fixed delay.
- Frame sampling has a bounded observation window, and the test captures a frame after adding guests and asserts that WebGL2 remains active.
- The visual check captures the starter park before and after enabling gridlines.
- [mobile-fps.spec.ts](mobile-fps.spec.ts) emulates a Pixel 8 (4× CPU throttle, device scale factor 2.6) with 2,000 and 5,000 guests and prints median FPS, p95 frame time and render scale. Budgets (55 and 30 FPS median) are soft: a miss adds a `soft-budget-miss` annotation and a warning, not a failure, because SwiftShader timing varies by host.
- [no-4xx.spec.ts](no-4xx.spec.ts) loads the game, opens every toolbar window and fails on any 4xx network response; under `pnpm smoke:subpath` it runs against the production build served at `/opencoaster/`.
- Playwright screenshots are stored in `.local/playwright-results/` (dev) and `.local/playwright-results-subpath/` (subpath).
- Specs navigate with `page.goto('./')` so the same spec runs at the origin root and under the subpath.

Created and maintained by Nori.
