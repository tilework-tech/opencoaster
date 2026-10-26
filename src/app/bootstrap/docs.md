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

- Creates shared app state and passes accessors or action callbacks into controllers, preserving one live source for camera, selected tool, settings and selection state. Toolbar rotation actions use the same centre-focus camera transform as pointer twist and keyboard rotation.
- Drives frame-time camera movement, scenario outcome observation, HUD/UI refresh, rendering and overlays from a single animation-frame callback. The loop synchronizes the UI's compass indicator with the camera's discrete rotation.
- Wires controller actions back into `SimClient` commands and pause/speed controls, including the tool controller's path and scenery removal callbacks used by canvas context menus. It creates the Land controller and one `AreaController` each for Clear scenery and Water, hands the same instances to camera input and the tool controller, routes the windows' `setLand` / `setClearScenery` / `setWater` settings to them, and calls each controller's `update` once per frame so previews, overlays and tooltips follow the latest worker answer. Pointer hover also supplies the renderer with the hovered tile and Shift/remove state; while Patrol is active, bootstrap sends the selected worker and preview state to the renderer before the world draw.
- On a new game, the map callback uses [opening-camera.ts](opening-camera.ts) to project the park gate and contiguous inward entrance path into the current camera rotation. It falls back to the map center when entrance coordinates are unavailable or negative; later map updates preserve the player's view.

### Things to Know

- `SimClient.onMap` receives the gate coordinates and path records from the worker map message. The opening target is the projected average horizontal position of the gate and up to three contiguous inward path tiles, using the gate tile's height, so scenario starts orient the camera around the entrance.
- The worker can transfer or recycle snapshot buffers, so UI/controller refreshes use the current frame data rather than retaining stale snapshots.
- The renderer draws the selected worker's existing patrol blocks and the current add/remove block preview at world draw depth. A marked block can show the red removal preview; Shift state and the Staff window's Remove tiles action are passed through as preview mode.

Created and maintained by Nori.
