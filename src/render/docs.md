# Noridoc: Rendering

Path: @/src/render

### Overview

- Turns worker snapshots and map data into the isometric park view without reading simulation state.
- Uses a WebGL2 instanced renderer with generated world sprites and keeps Canvas2D as a renderer fallback.
- Shares projection and picking rules with the main-thread input layer.

### How it fits into the larger codebase

- [src/main.ts](../main.ts) selects the backend, supplies the current [snapshot](../worker/snapshot.ts), forwards [map data](../worker/map-data.ts), and requests draws from the browser frame loop.
- [renderer.ts](renderer.ts) defines the renderer boundary. [src/worker](../worker/docs.md) publishes map geometry separately from changing simulation snapshots so renderers never access worker-owned world state.
- [projection.ts](projection.ts) provides world projection and tile picking used by rendering and build input; [create-renderer.ts](create-renderer.ts) handles WebGL setup and the Canvas2D fallback.
- The canvas is layered with DOM controls and overlays. The responsive toolbar's horizontal scrolling is styled in [index.html](../../index.html) and covered by the [mobile toolbar browser check](../../e2e/mobile-toolbar.spec.ts).
- The input camera helpers in [src/input](../input/docs.md) preserve the world point under a zoom anchor and cap device pixel ratio before passing viewport dimensions to `Renderer.resize`; pointer and picking math remain in CSS pixels.

### Core Implementation

- [webgl2-renderer.ts](webgl2-renderer.ts) loads `public/sprites/atlas.png` and its manifest for generated world artwork, combining them with a small procedural fallback atlas in one nearest-filtered texture. Manifest bounds and anchors position sprites; fallback cells cover missing assets. The separate UI sheet is loaded by the DOM toolbar and does not consume WebGL atlas space.
- [world-art.ts](world-art.ts) names material terrain textures, authored slope-shape and cliff-face assets, path connection/ramp/style/queue sprites, water frames, and scenery sprites. Slope masks set projected corner heights, and material cliff faces fill exposed edges at the outer map boundary. WebGL submits terrain, cliff faces, water, paths and queue rails, placeable scenery, ground flower beds, the gate, and snapshot entities in painter order.
- [tools/sprites](../../tools/sprites/docs.md) renders paths, water, operating ride art, facilities, coaster track and park structures. WebGL2 draws generated sprites at manifest frame size and anchor; `sprite-art.ts` chooses ride view and animation frame, facility front direction, track cell, and ride-category entrance or exit hut. Paths remain native anchored sprites selected by `pathSpriteName`; water remains an eight-frame palette-cycle tile texture lowered by `WATER_BANK.surfaceInset`. Canvas2D uses [canvas-atlas.ts](canvas-atlas.ts) for paths and water and [sprite-atlas.ts](sprite-atlas.ts) for rides, facilities, track, huts, and the park gate.
- [tools/art](../../tools/art/README.md) prepares the committed generated source sheets into PNG/JSON sprite pairs and packs a deterministic atlas and manifest before Vite development and production builds. This keeps generation out of the runtime path.
- Terrain rendering selects the opaque material texture from `terrainSurfaceSpriteName`. Each WebGL terrain quad projects its four corners from the tile's derived base height plus its four-bit corner mask, so adjacent tiles share their map corner elevations. A small directional light adjustment on sloped tiles brings out rolling relief. Directional cliff-face sprites fill exposed edges at the outer map boundary. The map encodes only one-level corner differences and has no separate steep-slope encoding.
- Ambient trees are a deterministic rendering decoration selected from grass-tile coordinates. They are not simulation entities or saved world objects. The snapshot carries park entrance coordinates so the renderer can place the generated gate.
- [canvas2d-renderer.ts](canvas2d-renderer.ts) indexes paths and scenery by tile and draws them during painter traversal. It reads the persisted path-style column to color footpaths, marks queue rails, and draws placeable scenery with simple shapes; it retains procedural terrain drawing, but loads the generated atlas through [canvas-atlas.ts](canvas-atlas.ts) to draw the rendered path sprites (anchored at frame size) and the tile-space water texture (affine-mapped onto the tile diamond), falling back to flat colours until the atlas loads. Its coaster track cells use the object atlas, with station huts drawn after track cells so entrances and exits remain visible. [canvas2d-renderer.test.ts](canvas2d-renderer.test.ts) covers these fallback details.
- [sprite-art.ts](sprite-art.ts) maps ride and facility types to generated keys. [webgl2-renderer.ts](webgl2-renderer.ts) and [canvas2d-renderer.ts](canvas2d-renderer.ts) draw rides, category-styled station huts, queue rails, and the park gate; coaster track is split by footprint cell and drawn in tile order.
- [track-preview.ts](../ui/track-preview.ts) uses the same ride, facility, station, and track sprites for placement ghosts. [placement-art.ts](placement-art.ts) checks affordability, every tile in the ride footprint, buildable land and disallowed surfaces, plus overlap with existing rides and coaster track before tinting the preview. This render-side check mirrors ride creation constraints; the simulation command remains authoritative.

### Things to Know

- Renderers consume read-only frame data. Preview validity is calculated by [placement-art.ts](placement-art.ts) from the current map and snapshot; simulation state changes and authoritative placement checks remain in [src/sim](../sim/core/docs.md) and its command path. Render-only trees do not mutate simulation state or saved worlds.
- WebGL sprite placement uses atlas frame bounds and bottom-centre anchor metadata to align props to their map position. Terrain quads project their four corners using map corner heights while sampling the material surface texture. Gridlines are disabled by default and can be toggled from the UI; the WebGL shader draws their subtle overlay on terrain tiles.
- WebGL water is a planar mesh at the water level. A fragment depth test clips it against the tile's interpolated terrain corners, so partially submerged shoreline slopes retain the water area below the surface without drawing water over raised land. Its generated water texture is opaque, and animation selects one of eight palette-cycle frames from the simulation tick; at the current 40 Hz target, each frame advances every eight ticks. Adjacent wet tiles meet at the same water plane.
- The integrated world art includes ambient trees, placeable scenery, flower beds, the park gate, path additions, and queue rails. Paths select tarmac, crazy paving, or dirt while queue paths use the dedicated queue sprite family.
- Queue rails are part of the generated queue path sprites from [tools/sprites](../../tools/sprites/docs.md). Both backends select those sprites from path edges; Canvas2D also has a procedural queue fallback while its atlas loads. Facility fronts use nearby path direction, and placement ghosts reuse the corresponding ride, facility, station, or track art keys.
- Weather shading and rain remain a DOM overlay styled in [index.html](../../index.html); the main UI updates its class from snapshot weather while title/menu state controls visibility.
- WebGL context loss pauses drawing until resources are restored. Initial WebGL setup failure is handled by the Canvas2D fallback; the [browser smoke checks](../../smoke/docs.md) exercise the rendered game, sample frame times, inspect starter-park terrain pixels for gaps and connected lake water, compare gridline frames, and check relevant build controls.

Created and maintained by Nori.
