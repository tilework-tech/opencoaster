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
- WebGL2 and [canvas2d-renderer.ts](canvas2d-renderer.ts) consume the generated art. Canvas2D resolves the same page store through [canvas-atlas.ts](canvas-atlas.ts), draws sprites at manifest frame size and anchor, and keeps procedural terrain and fallback drawing. [src/ui/track-preview.ts](../ui/track-preview.ts) uses generated ride keys for build-placement ghosts.
- [src/render/coaster-scene.ts](coaster-scene.ts) marks rides whose coaster or transport sprites are available so procedural track and vehicle markers are omitted for those rides. If coaster atlas art is not available, the renderer retains the procedural markers.

### Things to Know

- Atlas category names follow key prefixes in [tools/art/categories.ts](../../tools/art/categories.ts): `flat-rides`, `stalls`, `transport`, `track-<style>`, `vehicles`, and `coaster-<family>`. Coaster families have separate lazy pages; first use requests the matching category. WebGL's eight-page draw limit is handled by consecutive ordered batches, preserving painter order even when a view uses many ride categories.
- Native sprites are positioned with manifest frame dimensions and anchor metadata. Multi-tile coaster and transport track is represented as tile-sized cells so renderers can interleave it with other world content by painter depth.
- Terrain selects an opaque material surface from its slope mask and fills exposed map-boundary edges with directional cliff sprites. WebGL water is a planar surface below the recorded water level; the fragment shader clips it to interpolated terrain corners and shades by depth. Both renderers select animation frames from the simulation tick.
- Ambient trees are deterministic rendering decorations, not simulation entities or saved objects. Weather shading and rain are DOM overlays; worker snapshots provide the weather state.
- [src/sim](../sim/core/docs.md) owns simulation behavior and placement validation. [smoke/docs.md](../../smoke/docs.md) describes browser-level rendering and build-control checks.

Created and maintained by Nori.
