# Noridoc: App Tools

Path: @/src/app/tools

### Overview

- Converts canvas taps, holds and paint gestures into tile selection or simulation commands.
- Separates tool-specific command handlers and snapshot-based guest hit testing from event wiring.

### How it fits into the larger codebase

- [camera input](../input/docs.md) invokes the controller's click and path-removal callbacks.
- [bootstrap](../bootstrap/docs.md) provides the active tool settings, UI, camera, worker client and [ride setup](../ride-setup/docs.md) callback.
- Commands go through [SimClient](../../worker/sim-client.ts); ride selection uses [object-picking](../../input/object-picking.ts) against the latest snapshot.

### Core Implementation

- `createToolController` converts CSS-pixel canvas positions to map tiles, dispatches the active tool, and updates selection/UI state.
- [handlers.ts](handlers.ts) maps land, path, scenery, path additions, flowerbed and patrol actions to existing worker commands. Path placements send no slope, so the simulation follows the terrain.
- [path-feedback.ts](path-feedback.ts) shows a refused footpath: it reads the `Path` feedback domain from the snapshot, marks the tile with a red ghost, and shows the reason in a tooltip at the last pointer position for 2.5 seconds.
- [selection.ts](selection.ts) hit-tests guest positions from the current snapshot and builds the UI's guest-selection data.

### Things to Know

- A forced selection from a hold bypasses the active build tool; guest details are preferred, then ride hit testing is used for ride tiles.
- Tool status text reports requests, while command acceptance and resulting state remain authoritative in the simulation worker.

Created and maintained by Nori.
