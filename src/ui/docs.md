# Noridoc: User Interface

Path: @/src/ui

### Overview

- Builds the park toolbar, information windows, selection feedback, and performance HUD with DOM elements.
- Displays worker snapshots and timing statistics; authoritative game state remains in the simulation worker.
- Exposes selection, land, path, ride, and track tools, with placement behavior wired by the main thread.

### How it fits into the larger codebase

- [src/main.ts](../main.ts) connects [GameUI](game-ui.ts) callbacks to [SimClient](../worker/sim-client.ts), camera controls, screen-to-tile picking, and the renderer.
- Placement input is translated into simulation commands at the main-thread boundary. The worker applies commands to its owned [Simulation](../sim/core/simulation.ts) on a tick, then publishes a later snapshot.
- Park and finance panels read snapshot and worker-stat values. Guest details are selected from the current snapshot at click time and retain that snapshot's tick label.
- [Hud](hud.ts) combines worker timing and dropped-tick statistics with frame rate, render duration, visible sprite count, and renderer backend from the render loop.

### Core Implementation

- [game-ui.ts](game-ui.ts) creates the toolbar and togglable park, finance, and guest windows, updates their text from snapshots, and tracks selected tool and pause state.
- [src/main.ts](../main.ts) handles keyboard and pointer input: WASD and drag pan, wheel zooms around the pointer, Q/E rotate, Space toggles pause, and canvas clicks select guests or issue the active build command.
- A land click enqueues a one-tile raise; holding Shift enqueues a one-tile lower. Path clicks enqueue `placePath`. Ride clicks enqueue `createRide` for a Merry-Go-Round.
- The toolbar labels this mode `Track prototype`. Clicks use the first ride in the latest snapshot and pass the clicked tile through the snapshot's per-tile `buildable` gate before enqueueing. The tool places a station followed by flat segments at terrain height with direction and mode set to zero.
- Tool selection uses [projection.ts](../render/projection.ts) for screen-to-tile picking. [hud.ts](hud.ts) formats finance values from integer cents to dollars and displays render and simulation performance data.

### Things to Know

- Tool status text reports that a placement was requested; it is not confirmation that the worker accepted the command. Invalid map and track commands are silently ignored by their simulation command handlers.
- The track ownership check is a UI-level gate on the clicked tile, using the latest worker snapshot. Direct simulation track commands do not pass through this check.
- Current ride catalog entries all set `usesTrack` to false, so these station and flat segments are decorative geometry attached to the first ride; they do not create an operational coaster. The toolbar and selected-tool status identify this flow as a prototype.
- The build controls are intentionally narrow: there is no ride catalog selector, track direction or mode picker, entrance/exit placement tool, or command-result feedback yet.
- Game speed and pause controls affect the worker scheduler through [SimClient](../worker/sim-client.ts); rendering and panel refresh continue on the browser animation frame loop.
- The park panel shows guest and ride counts and simulation tick; park rating is unavailable. The finance panel shows cash and loan. Guest details remain unchanged as newer snapshots arrive until another selection replaces or clears them.
- Guest spawning from the toolbar is a development control that sends the existing `spawnGuests` command.

Created and maintained by Nori.
