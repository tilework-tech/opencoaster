# Noridoc: App Bootstrap

Path: @/src/app/bootstrap

### Overview

- Assembles the browser game from the renderer, worker client, UI and app controllers.
- Owns the animation-frame loop that updates rendering, UI, ride setup and audio.

### How it fits into the larger codebase

- [src/main.ts](../../main.ts) awaits `bootstrap`; the browser entry stays small while setup remains in the app layer.
- Bootstrap connects [SimClient](../../worker/sim-client.ts) snapshots and commands to the UI, [camera input](../input/docs.md), [tool actions](../tools/docs.md), [ride setup](../ride-setup/docs.md), and [save/load](../save-load/docs.md).
- Rendering consumes worker snapshots and map data through [src/render](../../render/docs.md); deterministic world state is defined under [src/sim/core](../../sim/core/docs.md) and updated by the worker.

### Core Implementation

- Creates shared app state and passes accessors or action callbacks into controllers, preserving one live source for camera, selected tool, settings and selection state.
- Drives frame-time camera movement, scenario outcome observation, HUD/UI refresh, rendering and overlays from a single animation-frame callback.
- Wires controller actions back into `SimClient` commands and pause/speed controls.

### Things to Know

- `SimClient.onMap` recentres the camera only when a new game starts; ordinary map updates preserve the player's view.
- The worker can transfer or recycle snapshot buffers, so UI/controller refreshes use the current frame data rather than retaining stale snapshots.

Created and maintained by Nori.
