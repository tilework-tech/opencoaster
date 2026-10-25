# Noridoc: E2E Playtest

Path: @/e2e

### Overview

- Browser playtests cover user-facing park setup, ride access, save flows, mobile input, and offline startup.
- Tests drive the Vite app through Playwright, exercising the UI, worker-backed simulation, and save system together.
- Starter Park browser flows cover flat-ride setup, admission pricing, save-file round trips, and ride and stall access. Ride flows also cover coaster and water rides, invalid placement explanations, testing/opening, guest use, and demolition. Separate cases verify research gating, right-click/long-press ride windows, touch input, and offline startup; the year-one objective run remains opt-in.

### How it fits into the larger codebase

- The root `pnpm e2e` command uses [playwright.e2e.config.ts](../playwright.e2e.config.ts) and the shared [playwright.config.ts](../playwright.config.ts); it complements the shorter smoke suite.
- Browser tests send actions through the same UI and simulation worker path as a player. Scenario setup centers the camera on the park gate and its contiguous inward entrance path.
- Mobile profiles use Chromium device emulation and touch injection. They exercise pointer handling and viewport behavior, not Safari or physical-device performance.
- Playwright stores screenshots and traces as test artifacts; ride-access tests attach visual checkpoints to the report.

### Core Implementation

- [starter-playtest.spec.ts](starter-playtest.spec.ts) starts Starter Park, hires staff, places and completes a flat ride, sets park admission pricing, and creates, exports, imports, and loads a named save. Its path-building step targets the configured entrance continuation, checks the selected tool's location feedback, and verifies the exported map contains more paths than the initial entrance connection. It confirms staff and ride state after restoration.
- [starter-ride-access.spec.ts](starter-ride-access.spec.ts) runs ride-access flows on desktop and emulated Pixel 8: the shared flow builds and opens a flat ride and food stall, then exercises research-gated coaster and water-ride categories, coaster families, Log Flume test/open/guest use, demolition of a flat ride, stall, and coaster with a refund confirmation, and desktop right-click / Pixel 8 long-press ride-window access. Other cases verify repeated ride types start entrance setup on the new ride and do not treat boarding tiles inside another ride as valid.
- [ride-access-repro.spec.ts](ride-access-repro.spec.ts) exercises end-to-end flat-ride and coaster setup, invalid placement explanations, testing/opening, guest use, and ride demolition through the UI.
- [art-scale.spec.ts](art-scale.spec.ts) imports a test save with the ride researched, prepares path access, and places a Swinging Ship and Top Spin on desktop and emulated Pixel 8. Paired screenshots show the placement preview and the same UI without that sprite; a fixed crop measures its visible area in CSS pixels. Each flow then completes and opens the ride. [people-scale.spec.ts](people-scale.spec.ts) starts Sandbox through the UI on desktop and Pixel 8, checks visible canvas detail, hires each staff role through the staff panel, and attaches park screenshots. [tools/sprites/generate.test.ts](../tools/sprites/generate.test.ts) checks generated people frame coverage, compact proportions, directional poses, and distinct staff role colors.
- [scenario-selection.spec.ts](scenario-selection.spec.ts) checks scenario tabs and previews, plus persistence of completed-park status across reloads.
- [footpath-tool.spec.ts](footpath-tool.spec.ts) drives the Footpaths window through the UI: a dragged run previews its tiles and cost and lays them on release, a refused run shows red tiles with the reason, right-click and long-press remove a footpath with a refund, piece mode builds and removes at the cursor, and the hint shows once. Shared helpers are in [footpath-helpers.ts](footpath-helpers.ts).
- [footpath-terrain.spec.ts](footpath-terrain.spec.ts) raises a clear owned Starter Park tile and verifies that paths follow the resulting neighboring slopes. It projects seeded map tiles through the live camera, so entrance-centered openings and viewport changes do not make clicks land on unrelated tiles.
- When enabled with `E2E_RUN_YEAR=1`, the final stage runs at 4× speed until the year-one outcome dialog appears and captures whether the objective was met or missed.
- Scenario startup centers the camera on the park gate and up to three contiguous inward entrance-path tiles; when entrance coordinates are unavailable, it falls back to the map center. The playtest derives the Starter Park continuation tile from its scenario definition so the path action stays aligned with the configured entrance.
- [land-tool.spec.ts](land-tool.spec.ts) drives the Land window on desktop and emulated Pixel 8 through the UI only: hover previews (corner, edge, tile, 3×3), price tooltip, refusals with reasons, tap, drag up and down, flatten, smooth, and checks the saved game against what the preview announced. Tiles are located by calibrating on the overlay diamond under the pointer rather than reading the camera; phones centre the camera below the target because the tool sheets cover the lower half of the full-screen canvas.
- [mobile-input.spec.ts](mobile-input.spec.ts) checks path tap and drag painting, pan and pinch effects via changed picked tiles, rotation controls, capped backing-buffer scale, page zoom/scroll prevention, visibility pause, and viewport resizing. It pauses the simulation, exports and deserializes the current save to locate a guest in the viewport, then long-presses the guest with Path active and asserts Guest details open. It also long-presses a path tile to check mobile removal, verifies saved map paths, and records HUD FPS samples with 2,000 guests on emulated Pixel 8.
- [mobile-runtime.spec.ts](mobile-runtime.spec.ts) checks the manifest, service-worker control, and that the app can reload offline and start a progressing sandbox simulation. It disables Chromium's HTTP cache before taking the browser offline, so the reload exercises the service-worker cache.
- [deferred-ui.spec.ts](deferred-ui.spec.ts) covers worker inspection and orders, patrol editing, Options categories, desktop resizing, Ctrl+S screenshot download, and the classic scenario selector tabs, preview and objective. Mobile guest/path coverage checks guest details, queue/slope/removal controls including touch-and-hold removal, and 44 px targets.
- When enabled with `E2E_RUN_YEAR=1`, the final stage runs at 4× speed until the year-one outcome dialog appears and captures whether the objective was met or missed.

### Things to Know

- Scenario startup centers the camera on the park gate and up to three contiguous inward entrance-path tiles; when entrance coordinates are unavailable, it falls back to the map center. The playtest derives the Starter Park continuation tile from its scenario definition so the path action stays aligned with the configured entrance.
- `pnpm e2e` runs against the Vite development server and does not build the app. The Starter Park save round-trip completes without advancing a full year; set `E2E_RUN_YEAR=1` to opt into the longer year-one objective outcome run.
- Repository screenshots captured by the UI flow are stored in [docs/screenshots](../docs/screenshots). The Starter Park ride-access runs attach their screenshots to the Playwright report; those attachment files are test artifacts rather than committed repository assets.
- Mobile profiles and SwiftShader are browser emulation; their screenshots and FPS samples verify the browser integration path but do not characterize physical phone GPU performance.
- [mobile.spec.ts](mobile.spec.ts) runs at a 390 px phone viewport with touch: it checks the scrolling toolbar, stacked bottom sheets, a 44 px minimum for every visible control, and tap-to-build.

Created and maintained by Nori.
