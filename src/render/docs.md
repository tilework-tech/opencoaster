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

- [sprite-pages.ts](sprite-pages.ts) owns the multi-page atlas shared by both renderers: it fetches `public/sprites/manifest.json`, loads the eager categories (world, people) at start and loads a lazy category (flat rides, stalls, coaster families, vehicles) the first time `resolve(spriteName)` meets one of its sprites or `requestCategory(name)` is called (for example when a build menu opens). Until a category's pages arrive its sprites resolve to nothing and the renderers draw their procedural fallback.
- [webgl2-renderer.ts](webgl2-renderer.ts) uploads each loaded page as its own nearest-filtered texture, plus a 512x320 procedural fallback texture. Every instance carries a texture slot; up to eight textures are bound per draw and the fragment shader selects by slot, so painter order is preserved in one draw call. A frame that touches more than eight distinct pages splits into consecutive draws. Manifest bounds and anchors position sprites; fallback cells cover missing assets. The separate UI sheet is loaded by the DOM toolbar and does not consume WebGL atlas space.
- [world-art.ts](world-art.ts) names material terrain textures, authored slope-shape and cliff-face assets, path connection/ramp/style/queue sprites, water frames, and scenery sprites. Slope masks set projected corner heights, and material cliff faces fill exposed edges at the outer map boundary. WebGL submits terrain, cliff faces, water, paths and queue rails, placeable scenery, ground flower beds, the gate, and snapshot entities in painter order.
- [tools/sprites](../../tools/sprites/docs.md) renders footpath sprites and the water texture from 3D models. Footpath sprites are marked `native` in the manifest: WebGL2 draws them at frame size with the anchor on the tile centre (`nativeSpriteWorldOffset`) and both renderers pick the sprite for the rotated camera (`pathSpriteName` rotates connection masks and ramp directions). Water is an eight-frame palette-cycle tile texture with broad, low-contrast ripples; both renderers lower its surface by `WATER_BANK.surfaceInset`, clip it against the same two triangles per terrain tile, and draw earthy bank faces from the resulting shoreline segments. WebGL2 also shades water by depth. [canvas-atlas.ts](canvas-atlas.ts) lets Canvas2D draw the same path sprites and water texture from the shared page store.
- [tools/art](../../tools/art/README.md) prepares the committed generated source sheets into PNG/JSON sprite pairs and packs a deterministic atlas and manifest before Vite development and production builds. This keeps generation out of the runtime path.
- Terrain rendering selects the opaque material texture from `terrainSurfaceSpriteName`. Each WebGL terrain quad projects its four corners from the tile's derived base height plus its four-bit corner mask, so adjacent tiles share their map corner elevations. A small directional light adjustment on sloped tiles brings out rolling relief. Directional cliff-face sprites fill exposed edges at the outer map boundary. The map encodes only one-level corner differences and has no separate steep-slope encoding.
- Ambient trees are a deterministic rendering decoration selected from grass-tile coordinates. They are not simulation entities or saved world objects. The snapshot carries park entrance coordinates so the renderer can place the generated gate.
- [canvas2d-renderer.ts](canvas2d-renderer.ts) indexes paths and scenery by tile and draws them during painter traversal. It reads the persisted path-style column to color footpaths, marks queue rails, and draws placeable scenery with simple shapes. Terrain remains procedural, with generated material surface sprites sampled on flat tiles when the atlas is loaded; sloped tile tops use solid fills. Canvas2D clips water to the submerged terrain polygon and draws shoreline bank faces from shared segments, using a uniform earthy colour for the banks. It falls back to flat terrain and water colours until the atlas loads. [canvas2d-renderer.test.ts](canvas2d-renderer.test.ts) covers these fallback details.

### Things to Know

- Render inputs are read-only frame data. Simulation behavior and placement validation stay in [src/sim](../sim/core/docs.md) and the main-thread command bridge; adding render-only trees does not mutate simulation state or save data.
- WebGL sprite placement uses atlas frame bounds and bottom-centre anchor metadata to align props to their map position. Terrain quads project their four corners using map corner heights while sampling the material surface texture. Gridlines are disabled by default and can be toggled from the UI; the WebGL shader draws their subtle overlay on terrain tiles.
- WebGL water is a planar mesh below the recorded water level. Shared terrain-corner clipping and shoreline-segment extraction provide the submerged tile footprint and bank faces in all camera rotations, including convex and concave corners. WebGL2 uses generated terrain cliff sprites for bank faces and shades water by depth; Canvas2D uses uniform earthy fills for its bank faces. The generated ripple texture is opaque, and animation selects one of eight palette-cycle frames from the simulation tick; at the current 40 Hz target, each frame advances every eight ticks. Canvas2D uses the same clipped footprint and shoreline segments, but its generated terrain surface textures currently apply only to flat tiles.
- The integrated world art includes ambient trees, placeable scenery, flower beds, the park gate, path additions, and queue rails. Paths select tarmac, crazy paving, or dirt while queue paths use the dedicated queue sprite family.
- Weather shading and rain remain a DOM overlay styled in [index.html](../../index.html); the main UI updates its class from snapshot weather while title/menu state controls visibility.
- WebGL context loss pauses drawing until resources are restored. Initial WebGL setup failure is handled by the Canvas2D fallback; the [browser smoke checks](../../smoke/docs.md) exercise the rendered game, sample frame times, inspect starter-park terrain pixels for gaps and connected lake water, compare gridline frames, and check relevant build controls.

Created and maintained by Nori.
