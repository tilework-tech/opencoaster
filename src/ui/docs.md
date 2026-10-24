# Noridoc: User Interface

Path: @/src/ui

### Overview

- This module builds the park controls, information windows, selection feedback, and performance HUD with DOM elements.
- It presents state from worker snapshots and statistics; authoritative game state remains in the simulation worker.
- Toolbar modes cover selection, land, path, ride, and track workflows, while actual placement awaits simulation commands.

### How it fits into the larger codebase

- [src/main.ts](../main.ts) wires [GameUI](game-ui.ts) actions to [SimClient](../worker/sim-client.ts), camera changes, and frame updates.
- [GameUI](game-ui.ts) sends pause, speed, rotation, tool selection, and guest-spawn actions through callbacks supplied by the main thread; it does not own simulation state.
- The park, finance, and guest panels read the current [worker snapshot](../worker/snapshot.ts) and stats. Guest selection details are captured by the main-thread input handler from the snapshot present at click time.
- [Hud](hud.ts) displays simulation timing and dropped ticks from worker stats alongside frame rate, render duration, visible sprite count, and renderer backend from the render loop.

### Core Implementation

- [game-ui.ts](game-ui.ts) creates the toolbar and togglable park, finance, and guest windows, updates their text from snapshots, and tracks the selected tool and pause button state.
- [hud.ts](hud.ts) formats the performance overlay and finance values, converting snapshot money from integer cents to dollars for display.
- [src/main.ts](../main.ts) handles keyboard and pointer input: WASD and drag pan, wheel zooms around the pointer, Q/E rotate, Space toggles pause, and canvas clicks select a nearby guest or show a tile coordinate.
- Tool selection uses [projection.ts](../render/projection.ts) for screen-to-tile picking. Until placement commands exist, choosing a build mode only reports the selected tile or that the click was outside the map.

### Things to Know

- Game speed and pause controls affect the worker scheduler via [SimClient](../worker/sim-client.ts); the UI continues rendering snapshots and performance data on the browser animation frame loop.
- The park panel currently shows guest and ride counts and the simulation tick; park rating is explicitly unavailable. The finance panel shows cash and loan. Guest details are a click-time snapshot labeled with its worker tick; they remain unchanged as newer snapshots arrive, until another selection replaces or clears them.
- Land, path, ride, and track modes are interface scaffolding only. They do not mutate terrain or create paths, rides, or track until the simulation command API supports placement.
- The guest-spawn toolbar action is a development control that sends the existing `spawnGuests` command.

Created and maintained by Nori.
