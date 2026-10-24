# Noridoc: Rendering

Path: @/src/render

### Overview

- Turns worker snapshots and map data into the isometric park view without reading simulation state.
- Uses a procedural WebGL2 atlas and instanced drawing, with Canvas2D as a fallback.
- Shares projection and picking rules with the main-thread input layer.

### How it fits into the larger codebase

- [src/main.ts](../main.ts) selects the backend, supplies the current [snapshot](../worker/snapshot.ts), forwards [map data](../worker/map-data.ts), and requests draws from the browser frame loop.
- [renderer.ts](renderer.ts) defines the renderer boundary: camera, snapshot entities, and static-until-revised map geometry.
- [src/worker](../worker/docs.md) publishes map geometry separately from changing simulation snapshots so the renderers never access worker-owned world state.
- [projection.ts](projection.ts) provides the world projection and tile picking used by rendering and build input; [create-renderer.ts](create-renderer.ts) handles WebGL setup and fallback.

### Core Implementation

- [webgl2-renderer.ts](webgl2-renderer.ts) generates the placeholder atlas at runtime, selects sprites from map flags and snapshot fields, culls visible tiles/entities, sorts by painter depth, then submits a single instanced quad batch.
- The atlas includes role-specific staff, trash and vomit, path additions, ride entrance/exit markers, queues, and ramp orientations. Path elements carry tile coordinates, base height, flags, and data, allowing the renderer to distinguish queues, elevated/sloped paths, bins, benches, rain shelters, and lamps.
- Terrain rendering uses surface and slope masks; water is drawn at each tile's `waterLevel`. Ride marker positions and placement flags come from `rideInfo`; dynamic guests, staff, rides, tracks, vehicles, and litter come from snapshot layers.
- [canvas2d-renderer.ts](canvas2d-renderer.ts) indexes path elements by tile when map data arrives, then draws each tile's paths and additions during terrain painter traversal. For ramps, it uses `PathFlag.SlopeDir` to project the low and high endpoints, fills the resulting sloped quadrilateral, and strokes its edge. This interleaves map elements with terrain instead of drawing every path in a separate pass. The fallback also draws water and ride markers.
- [projection.ts](projection.ts) keeps camera rotation, elevation-aware picking, and painter ordering in the same tile/world coordinate model.

### Things to Know

- Render inputs are read-only frame data. Simulation behavior and placement validation stay in [src/sim](../sim/core/docs.md) and the main-thread command bridge.
- In WebGL2, water above the tile's terrain height is submitted as a full-tile terrain-sized instance at the water level, so the surface covers the tile footprint while participating in the same depth ordering as other instances.
- Sprite art is procedural and generated at runtime, keeping the renderer independent of original game assets and external art files.
- Weather shading and rain are a DOM overlay styled in [index.html](../../index.html); the main UI updates its class from snapshot weather while title/menu state controls visibility.
- WebGL context loss pauses drawing until resources are restored; initial WebGL setup failure is handled by the Canvas2D fallback. The [browser smoke check](../../smoke/webgl2.spec.ts) exercises the rendered game and samples frame times.

Created and maintained by Nori.
