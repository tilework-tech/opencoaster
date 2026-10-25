# Noridoc: Rendering

Path: @/src/render

### Overview

- Turns worker snapshots and map data into the isometric park view without reading simulation state.
- Uses WebGL2 for the primary renderer and Canvas2D as a fallback, with a shared multi-page sprite atlas.
- Shares projection and picking rules with the main-thread input layer.

### How it fits into the larger codebase

- [src/main.ts](../main.ts) selects the backend, supplies the current [snapshot](../worker/snapshot.ts) and [map data](../worker/map-data.ts), and requests draws from the browser frame loop.
- [renderer.ts](renderer.ts) defines the renderer boundary. [src/worker](../worker/docs.md) publishes render-ready map and snapshot data; renderers do not access worker-owned simulation state.
- [projection.ts](projection.ts) provides world projection and tile picking for rendering and build input. [create-renderer.ts](create-renderer.ts) handles WebGL setup and Canvas2D fallback.
- [src/input](../input/docs.md) preserves the world point under zoom and caps device pixel ratio before passing viewport dimensions to the renderer. The canvas is layered with DOM controls and overlays from [index.html](../../index.html).
- [tools/sprites](../../tools/sprites/docs.md) creates the generated ride, facility, transport, coaster, path, and water assets; [tools/art](../../tools/art/README.md) packs them before development and production builds.

### Core Implementation

- [sprite-pages.ts](sprite-pages.ts) owns the manifest and page images shared by both renderers. World and people categories load at startup; lazy categories load when a sprite key is resolved or a UI surface calls `requestCategory`. Until a category is ready, callers can draw their procedural fallback.
- [webgl2-renderer.ts](webgl2-renderer.ts) uploads each loaded atlas page as a nearest-filtered texture and batches native sprite instances in painter order. A draw binds at most eight page textures; when consecutive instances require more pages, the batch is split at that boundary and subsequent draws retain the original instance order. A small procedural atlas supplies fallback sprites. The DOM toolbar's separate UI sheet is outside the world atlas.
- [world-art.ts](world-art.ts) derives ride, facility, entrance/exit hut, path, water, terrain, and scenery keys from snapshot and map values. Flat rides select one of four views and use the idle frame or tick-driven operating animation; facilities and station huts select direction-facing variants. The park entrance uses the generated gate sprite.
- [coaster-art.ts](coaster-art.ts) maps ride types to coaster or transport families and constructs track-cell, support, and vehicle keys. [coaster-scene.ts](coaster-scene.ts) turns snapshot track and car layers into a reusable painter-ordered list; track-piece cells follow piece direction and camera rotation, supports stack to the ground, and cars use their per-car pose. It selects track and vehicle art for coaster families, miniature railways, monorails, and chairlifts; log flumes and river rapids use the animated ride sprites selected through [world-art.ts](world-art.ts).
- Guest character sheets are processed by `tools/art/process-sprites.ts` as part of `pnpm art:prepare` into the eager `people` atlas category (keys `people/guest-walk#N`). Both renderers draw guest tint, heading and walk frame from the shared page store, each 32px sheet cell 1:1 (`GUEST_BOX` in [sprite-layout.ts](sprite-layout.ts)); the figure inside is about 22px tall, a third of a 64px tile's width. Generated two-frame staff sprites use cardinal direction variants from `tools/sprites/models/people.ts`; snapshots carry staff heading, and both renderers combine it with camera rotation to select the visible view. Canvas2D also draws ambient trees, flower beds and placeable scenery from the atlas in boxes shared with WebGL2 ([sprite-layout.ts](sprite-layout.ts)).
- WebGL2 and [canvas2d-renderer.ts](canvas2d-renderer.ts) consume the generated art. Canvas2D resolves the same page store through [canvas-atlas.ts](canvas-atlas.ts), draws sprites at manifest frame size and anchor, and keeps procedural terrain and fallback drawing. [src/ui/track-preview.ts](../ui/track-preview.ts) uses generated ride keys for build-placement ghosts.
- [src/render/coaster-scene.ts](coaster-scene.ts) marks rides whose coaster or transport sprites are available so procedural track and vehicle markers are omitted for those rides. If coaster atlas art is not available, the renderer retains the procedural markers.
- Ground cache: the WebGL renderer paints terrain, boundary cliff faces and flat path fill into 512×512 world-pixel textures on demand by reusing the instanced sprite shader and its page-texture runs at zoom 1 ([ground-chunks.ts](ground-chunks.ts) provides `chunkRange` and the LRU cache). Chunks are keyed by coordinate and cleared on rotation, gridline toggle, or when the `world` atlas category finishes loading; a new `MapData` drops only the chunks touching tiles whose height, surface, slope or water level changed. Each frame blits the visible chunks, then runs the sprite pass.
- Occluder pass: tiles that rise above the tiles behind them (computed per map and rotation) are re-submitted in the depth-sorted sprite pass together with the animated water planes, so raised terrain still hides guests, scenery and water behind it despite the cached ground.
- Sprite ordering uses [painter-order.ts](painter-order.ts) (stable counting sort) and `bufferSubData` uploads. [adaptive-resolution.ts](adaptive-resolution.ts) turns frame times into a backing-buffer scale; [src/app/bootstrap](../app/bootstrap/index.ts) applies it to the device pixel ratio passed to `Renderer.resize` and throttles HUD and panel DOM updates.

### Things to Know

- Atlas category names follow key prefixes in [tools/art/categories.ts](../../tools/art/categories.ts): `flat-rides`, `stalls`, `transport`, `track-<style>`, `vehicles`, and `coaster-<family>`. Coaster families have separate lazy pages; first use requests the matching category. WebGL's eight-page draw limit is handled by consecutive ordered batches, preserving painter order even when a view uses many ride categories.
- Native sprites are positioned with manifest frame dimensions and anchor metadata. Multi-tile coaster and transport track is represented as tile-sized cells so renderers can interleave it with other world content by painter depth.
- Terrain selects an opaque material surface from its slope mask and fills exposed map-boundary edges with directional cliff sprites. WebGL water is a planar surface below the recorded water level, lowered by `WATER_BANK.surfaceInset`; it is clipped against the same two terrain triangles per tile that the view's terrain quad uses (`terrainMeshTriangles`), and the fragment shader shades it by depth. Canvas2D clips against those same triangles so alternating corner heights keep separate submerged regions. Both renderers draw earthy bank faces from shared shoreline segments after each tile's water, so walls are never covered by their own tile's water. Both renderers select animation frames from the simulation tick.
- Placed scenery elements (`SmallScenery` from `map-data.ts`, including scenario trees) are drawn with their catalog sprite (`trees/...`, `scenery/...`). WebGL2 adds them to the same depth-sorted instance list as terrain, paths, rides and guests. Canvas2D draws them inside the tile pass, so terrain and paths are ordered correctly, but rides, staff, vehicles and guests are drawn in later passes and can paint over a tree that is in front of them. Trees use the single-frame atlas sprite in all four rotations; the sprite is rotation-invariant, so only its projected position changes.
- Ambient trees are deterministic rendering decorations, not simulation entities or saved objects. Weather shading and rain are DOM overlays; worker snapshots provide the weather state.
- [src/sim](../sim/core/docs.md) owns simulation behavior and placement validation. [smoke/docs.md](../../smoke/docs.md) describes browser-level rendering and build-control checks.

Created and maintained by Nori.
