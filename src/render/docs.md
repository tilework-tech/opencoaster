# Noridoc: Rendering

Path: @/src/render

### Overview

- The renderer turns the worker's transferable snapshots and map data into the isometric park view; it does not access simulation state.
- WebGL2 is the primary renderer, with a Canvas2D fallback. Both use procedural placeholder art.
- Projection helpers provide four view rotations, elevated tile picking, and the shared camera coordinate model.

### How it fits into the larger codebase

- [src/main.ts](../main.ts) selects a renderer, passes it map messages from [src/worker/sim-client.ts](../worker/sim-client.ts), and supplies the latest [snapshot format](../worker/snapshot.ts) on each frame.
- [renderer.ts](renderer.ts) defines the backend contract and the immutable-for-a-frame inputs: `MapData`, `Snapshot`, and `Camera`.
- [create-renderer.ts](create-renderer.ts) attempts WebGL2 setup and replaces the canvas with a fresh one if setup fails, allowing Canvas2D to attach cleanly.
- The renderer reports backend and visible-sprite counts to the main-thread HUD; camera pan, zoom, and rotation are controlled by the UI/input layer.

### Core Implementation

- [webgl2-renderer.ts](webgl2-renderer.ts) draws terrain and snapshot entities with one runtime-generated atlas and a single instanced quad batch. Grass, sand, dirt, and rock each have flat and slope sprites; the atlas also includes water, path, queue, guest, staff, ride, track, and train placeholders.
- Each frame, WebGL2 projects candidate tiles and entities, culls them against the viewport, sorts instances by rotated painter depth, uploads the ordered batch, and draws it. Per-tile slope masks lift the matching terrain corners. Atlas upload flips canvas rows with `UNPACK_FLIP_Y_WEBGL`, and shader UV mapping inverts atlas rows and terrain-local V so atlas cells and terrain diamonds sample upright. Sprite alpha uses source-alpha compositing over the scene; the track layer renders current track pieces.
- [canvas2d-renderer.ts](canvas2d-renderer.ts) provides a simpler fallback with isometric terrain and placeholder entity marks, drawing current track pieces and ride footprints with viewport culling.
- [projection.ts](projection.ts) implements continuous fixed-point world projection, tile-coordinate rotations, view dimensions, and `pickTile`, which maps viewport coordinates to the highest tile diamond under the pointer.

### Things to Know

- `MapData` is sent separately from snapshots and contains dimensions, heights, surface classes, and per-tile slope masks. WebGL2 uses the surface and mask to select terrain atlas sprites and lift the corresponding corners; the Canvas2D fallback also raises those corners. Entity positions, including track pieces, use the snapshot's four-integer stride; renderers unpack these values rather than holding simulation objects.
- Sprite art and terrain styling are generated at runtime. This keeps rendering independent of original game assets and external art files.
- WebGL2 context loss pauses drawing until restoration rebuilds GPU resources. Initial context or resource setup errors trigger the Canvas2D fallback through [create-renderer.ts](create-renderer.ts).
- Picking accounts for camera zoom, rotation, and map elevation. It is used for selection and tool feedback; it does not itself issue a simulation command.

Created and maintained by Nori.
