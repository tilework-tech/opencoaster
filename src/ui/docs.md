# Noridoc: User Interface

Path: @/src/ui

### Overview

- Builds the park toolbar, information windows, selection feedback, and performance HUD with DOM elements.
- Displays worker snapshots and timing statistics; authoritative game state remains in the simulation worker.
- Exposes selection, land, path, bin, bench, ride, coaster (track), and patrol tools, with placement behavior wired by the main thread.
- Provides a coaster panel for building, testing and operating coasters, with command feedback from snapshots.
- Hosts the game shell: a title screen (new scenario, sandbox, continue, load, import), an in-game menu (save to slots, load, export and import files, back to title), and a one-time scenario outcome dialog.

### How it fits into the larger codebase

- [src/main.ts](../main.ts) connects [GameUI](game-ui.ts) callbacks to [SimClient](../worker/sim-client.ts), camera controls, screen-to-tile picking, and the renderer.
- Placement input is translated into simulation commands at the main-thread boundary. The worker applies commands to its owned [Simulation](../sim/core/simulation.ts) on a tick, then publishes a later snapshot.
- Park and finance panels read snapshot and worker-stat values. Guest details are selected from the current snapshot at click time and retain that snapshot's tick label.
- [Hud](hud.ts) combines worker timing and dropped-tick statistics with frame rate, render duration, visible sprite count, and renderer backend from the render loop.
- [title-screen.ts](title-screen.ts), [save-menu.ts](save-menu.ts) and [scenario-dialog.ts](scenario-dialog.ts) are DOM overlays. They call into the save layer ([game-saves.ts](../save/game-saves.ts), [slot-store.ts](../save/slot-store.ts)) and the worker ([SimClient](../worker/sim-client.ts)) through callbacks wired in `main.ts`.

### Core Implementation

- [game-ui.ts](game-ui.ts) creates the toolbar and togglable park, finance, guest, and staff windows, updates their text from snapshots, and tracks selected tool and pause state.
- [src/main.ts](../main.ts) handles keyboard and pointer input: WASD and drag pan, wheel zooms around the pointer, Q/E rotate, Space toggles pause, and canvas clicks select guests or issue the active build command.
- A land click enqueues a one-tile raise; holding Shift enqueues a one-tile lower. Path clicks enqueue `placePath`. Ride clicks enqueue `createRide` for the ride type chosen in the panel.
- Bin and bench clicks enqueue `setPathAddition`; bins currently affect litter handling, while benches have no simulation behavior and neither addition is rendered. The Staff panel hires handymen, mechanics, security, or entertainers and selects a role for patrol painting. Patrol clicks set or clear one tile in that role's mask. The panel shows total staff count but does not expose firing controls or render patrol masks.
- The track tool is labelled `Coaster` and `selectTool` is public so the panel can switch to it. In track mode, clicks/Enter place the piece resolved by the panel at the selected ride's construction cursor; Backspace removes the last piece. In entrance/exit modes clicks enqueue `placeRideEntrance` / `placeRideExit`.
- [track-tool.ts](track-tool.ts) is pure logic: `classifyPiece` / `resolvePiece` map the shape, slope and bank controls to a catalog piece connectable at the cursor, plus `allowedModes`, `previewStatus`, `footprintTiles`, and `feedbackMessage`, which has text for every `TrackResult` and `RideResult`.
- [coaster-panel.ts](coaster-panel.ts) is the DOM panel: ride-type selector with cost, coaster selector, track/entrance/exit modes, shape/slope/bank/drive controls, start direction for the first piece, cost display, place/remove-last, Test/Open/Close buttons, ratings and status readout, and the command feedback line. Creating a ride selects it and switches to the track tool. It reads `Snapshot.rideInfo` (cursor decoded with `decodeCursor`).
- [track-preview.ts](track-preview.ts) draws an overlay canvas outlining the footprint of the piece about to be placed, green when `previewStatus` passes and red otherwise.
- Tool selection uses [projection.ts](../render/projection.ts) for screen-to-tile picking. [hud.ts](hud.ts) formats finance values from integer cents to dollars and displays render and simulation performance data.

### Things to Know

- Tool status text reports that a placement was requested. The authoritative outcome arrives in `Snapshot.feedback`, which the panel shows via `feedbackMessage` when `seq` changes. Map-command rejections remain silent.
- The placement preview is a client-side approximation using the snapshot (bounds, ownership via `buildable`, funds); the simulation result is authoritative and may differ.
- Ownership, ride-type rules and funds are enforced by the simulation's track command handler, not by the UI.
- Staff interactions are limited to hiring and role patrol masks. There is no firing control or patrol-mask overlay yet.
- Game speed and pause controls affect the worker scheduler through [SimClient](../worker/sim-client.ts); rendering and panel refresh continue on the browser animation frame loop.
- Speed and the player's pause choice are saved in `localStorage` ([settings.ts](settings.ts)) and restored on the next visit. The worker is also paused while the title screen, the in-game menu or an outcome dialog is open; that pause is not saved.
- Session lifecycle lives in `main.ts`. A new game, sandbox start, save load or import replaces the worker's game and clears the session's outcome state. Quitting to title clears the session. Loading a save reads only its header first (`summarizeSave`), so a bad file leaves the current game running.
- Scenario outcome: when a snapshot's scenario status leaves Active, the outcome dialog shows once per game. It offers keep playing (sandbox), the menu, or back to title. The objective strip ([objective.ts](objective.ts)) shows progress and the deadline. Until the first rating refresh (tick 512) the rating reads as pending.
- The park panel shows guest and ride counts, simulation tick and park rating. The finance panel shows cash and loan. Guest details remain unchanged as newer snapshots arrive until another selection replaces or clears them.
- Title and menu actions are asynchronous and their failures are shown in the overlay (for example a save that cannot be read, or storage that is unavailable; the title falls back to an in-memory store when IndexedDB cannot be opened, and says so).
- Guest spawning from the toolbar is a development control that sends the existing `spawnGuests` command.

Created and maintained by Nori.
