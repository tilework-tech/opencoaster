# Noridoc: Smoke

Path: @/smoke

### Overview

- This folder contains the quick browser smoke suite for the game renderer.
- `pnpm smoke` runs the WebGL2 integration check with a 5,000-guest park against the Vite dev server.
- `pnpm smoke:subpath` builds `dist/`, serves it under `/opencoaster/` without cross-origin isolation headers, and runs the same suite plus `deployed-base.spec.ts`, which checks the manifest, icons, sprite atlas, and service-worker scope resolve under the deploy base.

### How it fits into the larger codebase

- Playwright drives the Vite app through its browser UI and checks the canvas renderer, performance HUD, and console for browser errors.
- The longer Starter Park playtest lives in [e2e](../e2e/docs.md) and runs separately with `pnpm e2e`.
- The shared [Playwright configuration](../playwright.config.ts) runs browser checks one worker at a time and retains a trace when a test fails.

### Things to Know

- The smoke test adds 5,000 guests, pauses at the game menu, then waits for the displayed simulation tick to advance after resuming before sampling frames. This synchronizes the check with simulation progress rather than a fixed delay.
- Frame sampling has a bounded observation window, and the test captures a frame after adding guests and asserts that WebGL2 remains active.
- Playwright screenshots are stored in `.local/playwright-results/` (dev) and `.local/playwright-results-subpath/` (subpath).
- Specs navigate with `page.goto('./')` so the same spec runs at the origin root and under the subpath.

Created and maintained by Nori.
