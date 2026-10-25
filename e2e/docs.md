# Noridoc: E2E Playtest

Path: @/e2e

### Overview

- The e2e folder holds browser playtests for user-facing game flows.
- Starter Park browser flows cover flat-ride setup, admission pricing, save-file round trips, and ride, stall, and coaster access setup. The year-one objective run is opt-in; separate mobile flows cover touch input and offline startup.

### How it fits into the larger codebase

- Playwright drives the Vite development server through the browser UI, covering integration between the app, UI, worker-backed simulation, and save system.
- The root `pnpm e2e` command discovers the browser tests in this folder through [playwright.e2e.config.ts](../playwright.e2e.config.ts), which extends the shared configuration; it complements the shorter `pnpm smoke` suite.
- Browser tests inherit [playwright.config.ts](../playwright.config.ts), which starts the Vite dev server, runs tests serially, retains traces on failure, and supplies the base timeout. The long save round-trip playtest extends its own timeout for the optional year run and screenshot capture.
- Mobile tests use Playwright's iPhone 15 and Pixel 8 viewport/device profiles with Chromium DevTools touch injection to exercise the browser pointer-event path. They are Chromium emulation, not WebKit/Safari or physical-device runs.
- Test screenshots are written as Playwright output artifacts and attached to the test report, providing visual checkpoints for the sequence.

### Core Implementation

- [starter-playtest.spec.ts](starter-playtest.spec.ts) starts Starter Park, hires staff, places and completes a flat ride, sets park admission pricing, and creates, exports, imports, and loads a named save. Its path-building step targets the configured entrance continuation, checks the selected tool's location feedback, and verifies the exported map contains more paths than the initial entrance connection. It confirms staff and ride state after restoration.
- [starter-ride-access.spec.ts](starter-ride-access.spec.ts) runs ride-access flows on desktop and emulated Pixel 8: the shared flow builds and opens a flat ride and food stall, then builds, tests, and opens a coaster and checks guest use. Additional desktop runs cover Wooden, Junior, and Wild Mouse coaster families, rotate the view through all four orientations, and capture screenshots. A Log Flume flow constructs a water track with a powered climb and splash drop, tests and opens it, then checks that guests ride. A separate desktop case verifies that repeating a ride type starts entrance setup on the newly created ride and exposes its missing access checklist.
- [art-scale.spec.ts](art-scale.spec.ts) places a Swinging Ship and a Top Spin through the ride UI on desktop and emulated Pixel 8 with the simulation paused, diffs screenshots before and after, and asserts the sprite's on-screen area in CSS pixels. Guest figure size is covered by the sprite-processing unit test.
- [scenario-selection.spec.ts](scenario-selection.spec.ts) checks scenario tabs and previews, plus persistence of completed-park status across reloads.
- [footpath-terrain.spec.ts](footpath-terrain.spec.ts) raises a clear owned Starter Park tile and verifies that paths follow the resulting neighboring slopes. It projects seeded map tiles through the live camera, so entrance-centered openings and viewport changes do not make clicks land on unrelated tiles.
- When enabled with `E2E_RUN_YEAR=1`, the final stage runs at 4× speed until the year-one outcome dialog appears and captures whether the objective was met or missed.
- Scenario startup centers the camera on the park gate and up to three contiguous inward entrance-path tiles; when entrance coordinates are unavailable, it falls back to the map center. The playtest derives the Starter Park continuation tile from its scenario definition so the path action stays aligned with the configured entrance.
- [mobile-input.spec.ts](mobile-input.spec.ts) checks path tap and drag painting, pan and pinch effects via changed picked tiles, rotation controls, capped backing-buffer scale, page zoom/scroll prevention, visibility pause, and viewport resizing. It pauses the simulation, exports and deserializes the current save to locate a guest in the viewport, then long-presses the guest with Path active and asserts Guest details open. It also long-presses a path tile to check mobile removal, verifies saved map paths, and records HUD FPS samples with 2,000 guests on emulated Pixel 8.
- [mobile-runtime.spec.ts](mobile-runtime.spec.ts) checks the manifest, service-worker control, and that the app can reload offline and start a progressing sandbox simulation. It disables Chromium's HTTP cache before taking the browser offline, so the reload exercises the service-worker cache.

### Things to Know

- The deferred UI flow covers worker inspection and orders, patrol editing, Options categories, desktop resizing, Ctrl+S screenshot download, and the classic scenario selector tabs, preview and objective. Mobile guest/path coverage checks guest details, queue/slope/removal controls including touch-and-hold removal, and 44 px targets.
- Repository screenshots captured by the UI flow are stored in [docs/screenshots](../docs/screenshots).

- The UI exposes stall placement, covered by the desktop and Pixel 8 ride-access playthroughs; ride and stall pricing controls remain unavailable. Park admission pricing is still exercised by the Starter Park playtest.
- `pnpm e2e` runs against the Vite development server and does not build the app. The Starter Park save round-trip completes without advancing a full year; set `E2E_RUN_YEAR=1` to opt into the longer year-one objective outcome run.
- Screenshot filenames encode the sequence and are stored under Playwright’s test output directory rather than committed as repository assets. The Starter Park ride-access runs attach their screenshots to the Playwright report for review.
- Mobile profiles and SwiftShader are browser emulation; their screenshots and FPS samples verify the browser integration path but do not characterize physical phone GPU performance.

- `coaster-turns.spec.ts` imports a generated save of a closed steel looping coaster ([support/steel-showcase.ts](support/steel-showcase.ts): lift, banked and flat turns of several radii, drop, vertical loop, corkscrew, S-bend) and screenshots it in all four camera rotations.
- `mobile.spec.ts` runs at a 390 px phone viewport with touch: it checks the scrolling toolbar, stacked bottom sheets, a 44 px minimum for every visible control, and tap-to-build.

Created and maintained by Nori.
