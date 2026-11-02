# Noridoc: App Bootstrap

Path: @/src/app/bootstrap

### Overview

- Assembles the browser game from the renderer, worker client, UI and app controllers.
- Owns the animation-frame loop that updates rendering, UI, ride setup and audio. It also resolves visible live-view slots from current snapshots and schedules their offscreen refreshes.

### How it fits into the larger codebase

- [src/main.ts](../../main.ts) awaits `bootstrap`; the browser entry stays small while setup remains in the app layer.
- Bootstrap connects [SimClient](../../worker/sim-client.ts) snapshots and commands to the UI, [camera input](../input/docs.md), [tool actions](../tools/docs.md), [ride setup](../ride-setup/docs.md), and [save/load](../save-load/docs.md).
- Rendering consumes worker snapshots and map data through [src/render](../../render/docs.md); deterministic world state is defined under [src/sim/core](../../sim/core/docs.md) and updated by the worker.

### Core Implementation

- Creates shared app state and passes accessors or action callbacks into controllers, preserving one live source for camera, selected tool, settings and selection state. Toolbar rotation actions use the same centre-focus camera transform as pointer twist and keyboard rotation.
- Keeps the optional wall-edge override for the current scenery placement. With a wall selected, the scenery preview and click use that edge or derive the nearest edge from the pointer and projected tile; the `t` key and rotate control cycle the override through the four world edges. Changing the selected scenery item clears the override.
- Drives frame-time camera movement, scenario outcome observation, HUD/UI refresh, rendering and overlays from a single animation-frame callback. The loop synchronizes the UI's compass indicator with the camera's discrete rotation. Live viewport collection runs after layout on a throttled cadence, resolves stable entity IDs against the latest snapshot, and supplies a camera and canvas-relative rectangle to [src/render](../../render/docs.md). The refresh scheduler rotates through visible viewports, refreshing one WebGL2 target every three frames or one Canvas2D target every 100 ms.
- Wires controller actions back into `SimClient` commands and pause/speed controls, including the tool controller's path and scenery removal callbacks used by canvas context menus. It creates the Land controller and one `AreaController` each for Clear scenery and Water, hands the same instances to camera input and the tool controller, routes the windows' `setLand` / `setClearScenery` / `setWater` settings to them, and calls each controller's `update` once per frame so previews, overlays and tooltips follow the latest worker answer. Pointer hover also supplies the renderer with the hovered tile and Shift/remove state; while Patrol is active, bootstrap sends the selected worker and preview state to the renderer before the world draw.
- Wires track editing from a selected piece: the `editTrack(rideId, pieceId?)` action makes the ride active in the [CoasterPanel](../../ui/coaster-panel.ts), selects the track tool and, when a piece is given, selects it and shows the selection status. It passes `trackGhostAt` (backed by `TrackPreviewOverlay.hits`) to the [tool controller](../tools/docs.md) so ghost clicks keep building, and creates the [TrackSelectionOutline](../tools/track-selection-outline.ts), updated every frame from `coasterPanel.selectedPiece()`, the renderer, the latest snapshot and the camera, and disposed with the other overlays.
- On a new game, the map callback uses [opening-camera.ts](opening-camera.ts) to project the park gate and contiguous inward entrance path into the current camera rotation. It falls back to the map center when entrance coordinates are unavailable or negative; later map updates preserve the player's view.

### Things to Know

- `SimClient.onMap` receives the gate coordinates and path records from the worker map message. The opening target is the projected average horizontal position of the gate and up to three contiguous inward path tiles, using the gate tile's height, so scenario starts orient the camera around the entrance.
- The worker can transfer or recycle snapshot buffers, so UI/controller refreshes use the current frame data rather than retaining stale snapshots. Live viewports retain only the target ID; their world position and camera are recomputed from the current snapshot, so a departed target is omitted and its renderer target is released.
- The renderer draws the selected worker's existing patrol blocks and the current add/remove block preview at world draw depth. A marked block can show the red removal preview; Shift state and the Staff window's Remove tiles action are passed through as preview mode.
- The wall-edge override is tool state only. The chosen edge is included in the ordinary `placeScenery` command and is persisted with the map element by simulation/save code.

Created and maintained by Nori.
