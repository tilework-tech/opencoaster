# Noridoc: E2E Playtest

Path: @/e2e

### Overview

- The e2e folder holds the long browser playtest for the game’s user-facing flows.
- The Starter Park playtest exercises scenario entry, selected park-building and management actions, coaster construction, save-file round trips, and the year-one objective outcome.

### How it fits into the larger codebase

- Playwright drives the built game through its browser UI, covering the integration between the Vite app, UI, worker-backed simulation, and save system.
- The root `pnpm e2e` command runs the Starter Park test using the shared Playwright configuration; it complements the shorter `pnpm smoke` suite.
- Test screenshots are written as Playwright output artifacts and attached to the test report, providing visual checkpoints for the sequence.

### Core Implementation

- The test starts from the title screen, opens Starter Park, hires a handyman and mechanic, requests path placement, builds a flat ride, and closes one 13-piece steel coaster circuit containing a station, chain lift, and vertical loop.
- The test opens the finance panel to inspect the current UI and captures its state; it does not change prices because price controls are not exposed there.
- It creates a named save slot, exports the save file, imports that file, and loads the saved game before continuing the scenario.
- The final stage runs the game at 4× speed until the year-one outcome dialog appears, then captures whether the objective was met or missed.
- The playtest exposed a camera offset that left 64×64 Starter Park mis-centered in the default 128×128 view. The map callback now centers the camera from the loaded map dimensions.

### Things to Know

- The current UI does not expose stall placement or price controls, so those requested playtest actions remain uncovered. Coaster construction is available and exercised by the test.
- Unless `E2E_SKIP_YEAR=1` is set, the scenario runs at 4× speed to the year-one outcome; the assertion accepts either outcome and the screenshot records the result.
- Screenshot filenames encode the sequence and are stored under Playwright’s test output directory rather than committed as repository assets.

Created and maintained by Nori.
