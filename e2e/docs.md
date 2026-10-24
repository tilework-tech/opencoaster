# Noridoc: E2E Playtest

Path: @/e2e

### Overview

- The e2e folder holds browser playtests for user-facing game flows.
- Starter Park coverage exercises scenario entry, park building and management, coaster construction, and save-file round trips; the long year-one objective run is opt-in. Mobile coverage exercises touch input and offline startup.

### How it fits into the larger codebase

- Playwright drives the built game through its browser UI, covering the integration between the Vite app, UI, worker-backed simulation, and save system.
- The root `pnpm e2e` command runs the Starter Park and mobile browser tests using the shared Playwright configuration; it complements the shorter `pnpm smoke` suite.
- Mobile tests use Playwright's iPhone 15 and Pixel 8 viewport/device profiles with Chromium DevTools touch injection to exercise the browser pointer-event path. They are Chromium emulation, not WebKit/Safari or physical-device runs.
- Test screenshots are written as Playwright output artifacts and attached to the test report, providing visual checkpoints for the sequence.

### Core Implementation

- The test starts from the title screen, opens Starter Park, hires a handyman and mechanic, closes all windows with Shift+Backspace, requests path placement, builds a flat ride and a food stall from the New attraction window, and closes one 13-piece steel coaster circuit containing a station, chain lift, and vertical loop.
- The test opens the Finances window, then sets pay-to-enter mode and a park admission price in the Park window.
- It creates a named save slot, exports the save file, imports that file, and loads the saved game before continuing the scenario.
- When enabled with `E2E_RUN_YEAR=1`, the final stage runs at 4× speed until the year-one outcome dialog appears and captures whether the objective was met or missed.
- The playtest exposed a camera offset that left 64×64 Starter Park mis-centered in the default 128×128 view. The map callback now centers the camera from the loaded map dimensions.
- [mobile-input.spec.ts](mobile-input.spec.ts) checks path tap and drag painting, pan and pinch effects via changed picked tiles, rotation controls, capped backing-buffer scale, page zoom/scroll prevention, visibility pause, and viewport resizing. It pauses the simulation, exports and deserializes the current save to locate a guest in the viewport, then long-presses that guest with the Path tool active and asserts Guest details open. It also checks that the saved map data contains a path. Its emulated Pixel 8 performance case records HUD FPS samples with 2,000 guests.
- [mobile-runtime.spec.ts](mobile-runtime.spec.ts) checks the manifest, service-worker control, and that the app can reload offline and start a progressing sandbox simulation. It disables Chromium's HTTP cache before taking the browser offline, so the reload exercises the service-worker cache.

### Things to Know

- The current UI does not expose stall placement or price controls, so those requested playtest actions remain uncovered. Coaster construction is available and exercised by the test.
- The default `pnpm e2e` flow completes the build and save/import/load checks without advancing a full year. Set `E2E_RUN_YEAR=1` to opt into the year-one scenario outcome; that run exceeded the 850-second expectation, so it is kept out of the default suite.
- Screenshot filenames encode the sequence and are stored under Playwright’s test output directory rather than committed as repository assets.
- Mobile profiles and SwiftShader are browser emulation; their screenshots and FPS samples verify the browser integration path but do not characterize physical phone GPU performance.

Created and maintained by Nori.

- `mobile.spec.ts` runs at a 390 px phone viewport with touch: it checks the scrolling toolbar, stacked bottom sheets, a 44 px minimum for every visible control, and tap-to-build.
