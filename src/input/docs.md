# Noridoc: Input

Path: @/src/input

### Overview

- Converts browser pointer gestures into camera movement, view rotation, selection, and map-tool actions.
- Keeps gesture state on the main thread; simulation mutations continue through the existing command bridge.
- Provides shared camera helpers for discrete RCT-style zoom levels and bounded render resolution.

### How it fits into the larger codebase

- [src/app/input](../app/input/docs.md) owns application-level browser wiring: it adapts DOM events, connects [pointer-input.ts](pointer-input.ts), and routes gesture intents to camera and tool callbacks. In Select mode it offers mouse drags and a touch long-press followed by movement to the person-move callbacks. [src/app/bootstrap](../app/bootstrap/docs.md) supplies those dependencies.
- Camera coordinates and rotation are consumed by [src/render](../render/docs.md); terrain hit-testing uses its projection and terrain-triangle picker, so elevated and sloped surfaces resolve to the tile beneath the pointer. In Select mode, the renderer's shared sprite picker tests atlas alpha masks before the app falls back to tile selection.
- Tap and paint actions call the same canvas action path as desktop clicks, which converts screen coordinates to tiles and queues existing simulation commands.
- The input module owns gesture recognition only. It does not keep map, guest, selection-window, or simulation state.

### Core Implementation

- [pointer-input.ts](pointer-input.ts) tracks active pointers, distinguishes taps from drags using a small movement threshold, and recognizes touch holds after a delay. In Select mode, a desktop drag first asks the app whether a person is under its start point; a successful pickup follows the pointer and drops on release instead of panning. A touch hold asks the same question after 900 ms and, when a person is picked up, movement and release complete the drag. If no person is picked up, the hold retains the normal forced-selection behavior. One-pointer select gestures otherwise pan; with the land tool active a two-finger gesture also pans by its midpoint (one-finger drags edit terrain). Every first pointer down reports a tool-agnostic `press`; the app routes it to Land, Clear scenery or Water so touch input shows a preview before the tap lands. Path tools and patrol painting interpolate drag segments at no more than 12 CSS pixels between samples. The app converts patrol samples through the terrain-aware tile picker and ignores consecutive samples that land on the same tile.
- Two active pointers establish a pinch baseline and midpoint. Distance changes report zoom scale around that midpoint; twist deltas accumulate until they cross 45 degrees, then request one quarter-turn per threshold crossing.
- [camera-controls.ts](camera-controls.ts) snaps zoom to the supported scale set, preserves the world position under the zoom anchor, steps wheel zoom between levels, and caps device pixel ratio for rendering. Camera rotation is a quarter-turn around the world point at the viewport centre: the helper estimates a sloped terrain tile's centre elevation from its four corner heights, prefers a nearby raised path or coaster track, then converts the focus through the current projection and projects it into the next view before updating the camera.
- [src/app/input](../app/input/docs.md) de-duplicates repeated paint commands within the same tile and routes touch holds through person pickup in Select mode, forced selection when no eligible person is picked up, and path removal in Footpaths mode. Desktop context clicks are routed per tool by [src/app/input](../app/input/docs.md). [src/app/tools](../app/tools/docs.md) uses renderer-picked targets for object selection and keeps tile-based ride lookup as the terrain fallback.
- [object-picking.ts](object-picking.ts) builds alpha masks from the shared sprite atlas and projects target bounds using the current camera, map and viewport. It sorts targets by painter depth and tests them in reverse order, ignoring transparent source pixels. Flat rides, tracked-ride track cells, supports, cars and seated riders, placed entrances and exits, the park gate, walking guests and staff, scenery, and path additions produce targets; terrain tile picking and footprint/track lookup remain the fallback when no sprite target is hit. Both renderers expose the same target list through their `pickObject` interface.
- [wall-edge.ts](wall-edge.ts) chooses the closest projected terrain edge for wall scenery placement. It projects the four terrain corners with the current slope and camera rotation, then measures pointer distance to each edge segment; this keeps cursor selection aligned with the rendered diamond on raised and sloped tiles.

### Things to Know

- Pointer coordinates are browser CSS pixels. Camera zoom helpers and projection receive CSS viewport dimensions; the renderer's capped device-pixel ratio affects backing-buffer resolution only.
- Starting a second pointer cancels pending one-finger holds and starts a pinch. Pointer cancellation clears the gesture state and ends the active zoom sequence.
- The controller sends gesture intents; it does not decide whether a tile is in the park or whether a build command succeeds. Alpha-mask sprite picking selects visible objects; terrain tile picking and worker feedback remain authoritative at their existing boundaries.
- The visible view rotation is discrete. Accumulated twist movement can cross multiple thresholds during one gesture; each crossing requests one quarter-turn. Repeated turns use the same world-space focus point and cycle through the four projection orientations.
- Wall-edge selection is expressed in world-edge indices, independent of camera rotation. It uses the same terrain corner projection as tile picking, so a pointer near a visual corner resolves to the nearest of the actual sloped edge segments.
- The camera moves only on drag/pinch/wheel/WASD input, explicit locate actions, and the map of a started or loaded game (`SimClient.onMap(map, newGame)`, wired in [src/app/bootstrap](../app/bootstrap/docs.md)). The worker republishes the map after every terrain, path or scenery edit; those republishes must not recentre the view. `e2e/camera-stability.spec.ts` clicks many tiles and asserts the camera is unchanged (dev builds expose `window.__camera`). Held WASD keys are cleared on window blur.

Created and maintained by Nori.
