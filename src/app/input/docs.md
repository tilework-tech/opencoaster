# Noridoc: App Input

Path: @/src/app/input

### Overview

- Wires browser resize, visibility, keyboard, wheel and pointer events to camera and game actions.
- Adapts the reusable gesture recognizer to the app's camera, UI and tool callbacks.

### How it fits into the larger codebase

- [bootstrap](../bootstrap/docs.md) provides the renderer, `SimClient`, camera, selected-tool access and tool action callbacks.
- Gesture recognition comes from [src/input](../../input/docs.md); screen projection and tile picking use [src/render](../../render/docs.md).
- Canvas actions are delegated to [tool handling](../tools/docs.md); this module does not issue map-edit commands itself. Footpath line drags go through `PathDragHandlers`, and a drag that starts in piece mode pans instead.

### Core Implementation

- `connectCameraInput` installs DOM event handlers, tracks held keys, updates render dimensions, and connects pointer gestures to pan, zoom, rotation, selection and paint callbacks.
- `centreOnTile` projects a map tile into camera coordinates for locate actions.
- Input is gated by active-game and overlay callbacks; visibility changes update app pause state.

### Things to Know

- Pointer and wheel positions use CSS-pixel coordinates, while the renderer applies a capped device-pixel ratio to its backing buffer.
- The returned key set is read by bootstrap's frame loop for continuous WASD panning.

Created and maintained by Nori.
