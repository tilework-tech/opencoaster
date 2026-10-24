# Noridoc: User Interface

Path: @/src/ui

### Overview

- Builds the park toolbar, information windows, selection feedback, and performance HUD with DOM elements.
- Displays worker snapshots and timing statistics; authoritative game state remains in the simulation worker.
- Exposes selection, land, path, ride, and coaster (track) tools, with placement behavior wired by the main thread.
- Provides a coaster panel for building, testing and operating coasters, with command feedback from snapshots.

### How it fits into the larger codebase

- [src/main.ts](../main.ts) connects [GameUI](game-ui.ts) callbacks to [SimClient](../worker/sim-client.ts), camera controls, screen-to-tile picking, and the renderer.
- Placement input is translated into simulation commands at the main-thread boundary. The worker applies commands to its owned [Simulation](../sim/core/simulation.ts) on a tick, then publishes a later snapshot.
- Park and finance panels read snapshot and worker-stat values. Guest details are selected from the current snapshot at click time and retain that snapshot's tick label.
- [Hud](hud.ts) combines worker timing and dropped-tick statistics with frame rate, render duration, visible sprite count, and renderer backend from the render loop.

### Core Implementation

- [game-ui.ts](game-ui.ts) creates the toolbar and togglable park, finance, and guest windows, updates their text from snapshots, and tracks selected tool and pause state.
- [src/main.ts](../main.ts) handles keyboard and pointer input: WASD and drag pan, wheel zooms around the pointer, Q/E rotate, Space toggles pause, and canvas clicks select guests or issue the active build command.
- A land click enqueues a one-tile raise; holding Shift enqueues a one-tile lower. Path clicks enqueue `placePath`. Ride clicks enqueue `createRide` for the ride type chosen in the panel.
- The track tool is labelled `Coaster` and `selectTool` is public so the panel can switch to it. In track mode, clicks/Enter place the piece resolved by the panel at the selected ride's construction cursor; Backspace removes the last piece. In entrance/exit modes clicks enqueue `placeRideEntrance` / `placeRideExit`.
- [track-tool.ts](track-tool.ts) is pure logic: `classifyPiece` / `resolvePiece` map the shape, slope and bank controls to a catalog piece connectable at the cursor, plus `allowedModes`, `previewStatus`, `footprintTiles`, and `feedbackMessage`, which has text for every `TrackResult` and `RideResult`.
- [coaster-panel.ts](coaster-panel.ts) is the DOM panel: ride-type selector with cost, coaster selector, track/entrance/exit modes, shape/slope/bank/drive controls, start direction for the first piece, cost display, place/remove-last, Test/Open/Close buttons, ratings and status readout, and the command feedback line. Creating a ride selects it and switches to the track tool. It reads `Snapshot.rideInfo` (cursor decoded with `decodeCursor`).
- [track-preview.ts](track-preview.ts) draws an overlay canvas outlining the footprint of the piece about to be placed, green when `previewStatus` passes and red otherwise.
- Tool selection uses [projection.ts](../render/projection.ts) for screen-to-tile picking. [hud.ts](hud.ts) formats finance values from integer cents to dollars and displays render and simulation performance data.

### Things to Know

- Tool status text reports that a placement was requested. The authoritative outcome arrives in `Snapshot.feedback`, which the panel shows via `feedbackMessage` when `seq` changes. Map-command rejections remain silent.
- The placement preview is a client-side approximation using the snapshot (bounds, ownership via `buildable`, funds); the simulation result is authoritative and may differ.
- Ownership, ride-type rules and funds are enforced by the simulation's track command handler, not by the UI.
- Game speed and pause controls affect the worker scheduler through [SimClient](../worker/sim-client.ts); rendering and panel refresh continue on the browser animation frame loop.
- The park panel shows guest and ride counts and simulation tick; park rating is unavailable. The finance panel shows cash and loan. Guest details remain unchanged as newer snapshots arrive until another selection replaces or clears them.
- Guest spawning from the toolbar is a development control that sends the existing `spawnGuests` command.

Created and maintained by Nori.
