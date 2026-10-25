# Noridoc: Rendering

Path: @/src/render

### Overview

- Turns worker snapshots and map data into the isometric park view without reading simulation state.
- Uses a WebGL2 instanced renderer with generated sprites, and keeps Canvas2D as a renderer fallback with generated flat-ride sprites.
- Shares projection and picking rules with the main-thread input layer.

### How it fits into the larger codebase

- [src/main.ts](../main.ts) selects the backend, supplies the current [snapshot](../worker/snapshot.ts), forwards [map data](../worker/map-data.ts), and requests draws from the browser frame loop.
- [renderer.ts](renderer.ts) defines the renderer boundary. [src/worker](../worker/docs.md) publishes map geometry separately from changing simulation snapshots so renderers never access worker-owned world state.
- [projection.ts](projection.ts) provides world projection and tile picking used by rendering and build input; [create-renderer.ts](create-renderer.ts) handles WebGL setup and the Canvas2D fallback.
- The canvas is layered with DOM controls and overlays. The responsive toolbar's horizontal scrolling is styled in [index.html](../../index.html) and covered by the [mobile toolbar browser check](../../e2e/mobile-toolbar.spec.ts).
- The input camera helpers in [src/input](../input/docs.md) preserve the world point under a zoom anchor and cap device pixel ratio before passing viewport dimensions to `Renderer.resize`; pointer and picking math remain in CSS pixels.

### Core Implementation

- [webgl2-renderer.ts](webgl2-renderer.ts) creates a procedural fallback atlas immediately, then asynchronously loads `public/sprites/atlas.png` and its manifest. When available, generated sprites and the fallback atlas are combined into one nearest-filtered texture; requested frames use manifest bounds and anchors, while missing sprites use procedural atlas cells. Packing caps the generated atlas at 1024×2048 so the combined texture remains within WebGL2's guaranteed 2048-pixel dimension limit; runtime setup also checks the device's reported texture limit.
- Flat rides are selected from the ride snapshot by catalog type and origin tile. [sprite-art.ts](sprite-art.ts) derives the manifest key from ride type and camera rotation and selects idle frame 0 outside an active cycle, or frames 1–8 from the simulation tick during Loading, Running, and Unloading. Both renderers align the selected frame to the projected ride origin using its manifest anchor.
- [world-art.ts](world-art.ts) maps terrain surface and slope masks, path connection and ramp flags, water ticks, and scenery identifiers to sprite names. Terrain and water, path elements, path additions, ground flower beds, and the park gate are submitted with snapshot entities in painter order.
- [tools/art](../../tools/art/README.md) prepares the committed generated source sheets into PNG/JSON sprite pairs and packs a deterministic atlas and manifest before Vite development and production builds. This keeps generation out of the runtime path.
- Terrain currently receives a 4-bit slope mask from map data. The art catalogue names 19 terrain variants per material, but only masks `00` through `0f` are addressable; the additional three variants are prepared but not selected by the renderer.
- Ambient trees are a deterministic rendering decoration selected from grass-tile coordinates. They are not simulation entities or saved world objects. The snapshot carries park entrance coordinates so the renderer can place the generated gate.
- [canvas2d-renderer.ts](canvas2d-renderer.ts) indexes path elements by tile and draws terrain and map additions during painter traversal. It loads the sprite manifest and atlas asynchronously for flat rides; the rest of its map and ride fallback drawing remains procedural.

### Things to Know

- Render inputs are read-only frame data. Simulation behavior and placement validation stay in [src/sim](../sim/core/docs.md) and the main-thread command bridge; adding render-only trees does not mutate simulation state or save data.
- WebGL sprite placement uses atlas frame bounds and bottom-centre anchor metadata to align props to their map position. Terrain instances instead use the slope mask to raise their corresponding tile corners in the vertex shader.
- Water animation selects one of four atlas frames from the simulation tick; at the current 40 Hz target, each frame advances every eight ticks.
- The currently integrated generated scenery includes ambient tree types, flower beds, the park gate, and path bins, benches, and lamps. Other prepared prop sprites remain available in the atlas but are not yet selected by world rendering.
- Weather shading and rain remain a DOM overlay styled in [index.html](../../index.html); the main UI updates its class from snapshot weather while title/menu state controls visibility.
- WebGL context loss pauses drawing until resources are restored. Initial WebGL setup failure is handled by the Canvas2D fallback; the [browser smoke check](../../smoke/webgl2.spec.ts) exercises the rendered game and samples frame times.

Created and maintained by Nori.
