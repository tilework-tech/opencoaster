# Noridoc: Input

Path: @/src/input

### Overview

- Converts browser pointer gestures into camera movement, view rotation, selection, and map-tool actions.
- Keeps gesture state on the main thread; simulation mutations continue through the existing command bridge.
- Provides shared camera helpers for discrete RCT-style zoom levels and bounded render resolution.

### How it fits into the larger codebase

- [src/main.ts](../main.ts) adapts browser `PointerEvent`s to the input module and connects its actions to the current camera, renderer, UI, and `SimClient`.
- Camera coordinates and rotation are consumed by [src/render](../render/docs.md); pointer hit-testing uses that folder's projection and tile-picking functions.
- Tap and paint actions call the same canvas action path as desktop clicks, which converts screen coordinates to tiles and queues existing simulation commands.
- The input module owns gesture recognition only. It does not keep map, guest, selection-window, or simulation state.

### Core Implementation

- [pointer-input.ts](pointer-input.ts) tracks active pointers, distinguishes taps from drags using a small movement threshold, and recognizes touch holds after a delay. One-pointer select gestures pan; land and path tools paint along the drag path, interpolating segments at no more than 12 CSS pixels between paint samples.
- Two active pointers establish a pinch baseline and midpoint. Distance changes report zoom scale around that midpoint; twist deltas accumulate until they cross 45 degrees, then request one quarter-turn per threshold crossing.
- [camera-controls.ts](camera-controls.ts) snaps zoom to the supported scale set, preserves the world position under the zoom anchor, steps wheel zoom between levels, and caps device pixel ratio for rendering.
- `main.ts` de-duplicates repeated paint commands within the same tile and routes a hold through forced object selection regardless of the active build tool, leaving tile picking, placement validation, and guest lookup at the established main-thread boundary.

### Things to Know

- Pointer coordinates are browser CSS pixels. Camera zoom helpers and projection receive CSS viewport dimensions; the renderer's capped device-pixel ratio affects backing-buffer resolution only.
- Starting a second pointer cancels pending one-finger holds and starts a pinch. Pointer cancellation clears the gesture state and ends the active zoom sequence.
- The controller sends gesture intents; it does not decide whether a tile is in the park or whether a build command succeeds. Tile picking and worker feedback remain authoritative at their existing boundaries.
- The visible view rotation is discrete. Accumulated twist movement can cross multiple thresholds during one gesture; each crossing requests one quarter-turn.

Created and maintained by Nori.
