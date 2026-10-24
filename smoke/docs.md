# Noridoc: Smoke

Path: @/smoke

### Overview

- This folder contains the quick browser smoke suite for the game renderer.
- `pnpm smoke` runs the WebGL2 integration check with a 5,000-guest park.

### How it fits into the larger codebase

- Playwright drives the Vite app through its browser UI and checks the canvas renderer, performance HUD, and console for browser errors.
- The longer Starter Park playtest lives in [e2e](../e2e/docs.md) and runs separately with `pnpm e2e`.

### Things to Know

- The smoke test captures a frame after adding 5,000 guests and asserts that WebGL2 remains active.
- Playwright screenshots are stored in `.local/playwright-results/`.

Created and maintained by Nori.
