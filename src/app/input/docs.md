# Noridoc: App Input

Path: @/src/app/input

### Overview

- Wires browser resize, visibility, keyboard, wheel and pointer events to camera and game actions.
- Adapts the reusable gesture recognizer to the app's camera, UI and tool callbacks, including per-tool desktop context-click actions, person drag gestures, and forced selection from touch holds.

### How it fits into the larger codebase

- [bootstrap](../bootstrap/docs.md) provides the renderer, `SimClient`, camera, selected-tool access and tool action callbacks.
- Gesture recognition comes from [src/input](../../input/docs.md); screen projection and tile picking use [src/render](../../render/docs.md).
- Canvas actions are delegated to [tool handling](../tools/docs.md); this module does not issue map-edit commands itself. Person drag callbacks pass through to that controller, which validates a drop and sends the simulation command. Footpath line drags go through `PathDragHandlers`, and a drag that starts in piece mode pans instead. Patrol drags travel through the pointer paint callback, which picks and de-duplicates tiles before the tool controller sends per-worker patrol commands.

### Core Implementation

- `connectCameraInput` installs DOM event handlers, tracks held keys, updates render dimensions, and connects pointer gestures to pan, zoom, rotation, selection and paint callbacks. Pointer twist and the keyboard shortcuts resolve rotation through the shared camera helper using the current map and latest track snapshot, so elevated surfaces can define the viewport-centre focus. Pointer movement uses `pickTile` against projected terrain triangles for build-hover state and canvas actions; interpolated patrol drag samples are spaced no more than 12 CSS pixels apart and repeated samples that resolve to the same tile are suppressed. Shift is forwarded to the tool command and the renderer's patrol preview mode, so the preview switches to removal styling as the pointer gesture changes.
- The canvas context menu is always suppressed, so the browser menu never appears over the map. The right-click is then routed by the selected tool:

| Tool           | Right-click                                                                      |
| -------------- | -------------------------------------------------------------------------------- |
| Select         | Forced selection: opens the ride or stall under the pointer, otherwise the guest |
| Patrol         | Removes the patrol tile, the same as a Shift-click                               |
| Footpaths      | Removes the path under the pointer                                               |
| Any other tool | Single-tile scenery removal (a ride on the tile opens its window instead)        |

- Patrol right-click removal is a deliberate departure from RCT2/OpenRCT2, where right-click does not remove patrol tiles ([OpenRCT2 #25646](https://github.com/OpenRCT2/OpenRCT2/pull/25646)): the patrol tool here only adds on a plain tap rather than toggling, so right-click gives desktop players a removal gesture besides Shift. `e2e/context-menu.spec.ts` checks that both suppress the browser menu.
- In Select mode, a mouse drag attempts person pickup at the drag origin; a successful pickup suppresses camera panning until release. On touch, a 900 ms hold attempts person pickup and subsequent movement drops the person, while a hold without a pickup forces selection. Footpaths uses a touch hold to remove a path.
- Pointer routing for area tools: the gesture recognizer's `press` and mouse hover/leave go to the Land controller or the matching Clear scenery / Water `AreaController` depending on the selected tool. Land receives terrain-edit drags, path line mode receives path-run drags, and Patrol receives interpolated paint samples; the other tools retain their click actions. Patrol context-click uses the same tile command path with removal enabled, while Shift-click and the staff window's Remove tiles action also remove the selected worker's block.
- `centreOnTile` projects a map tile into camera coordinates for locate actions.
- Input is gated by active-game and overlay callbacks; visibility changes update app pause state.

### Things to Know

- Pointer and wheel positions use CSS-pixel coordinates, while the renderer applies a capped device-pixel ratio to its backing buffer. Rotation controls are independent of the active map tool and floating windows; they update the shared camera state used by the renderer.
- The returned key set is read by bootstrap's frame loop for continuous WASD panning.

Created and maintained by Nori.
