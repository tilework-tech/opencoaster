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

- [webgl2-renderer.ts](webgl2-renderer.ts) draws terrain and snapshot entities with one runtime-generated atlas and a single instanced quad batch. Its atlas contains procedural terrain, slope, path, guest, staff, ride, track, and train placeholders.
- Each frame, WebGL2 projects candidate tiles and entities, culls them against the viewport, sorts instances by rotated painter depth, uploads the ordered batch, and draws it. Sprite alpha uses source-alpha compositing over the scene. Snapshot tracks are accepted when present; the current simulation does not publish a track layer.
- [canvas2d-renderer.ts](canvas2d-renderer.ts) provides a simpler fallback with isometric terrain and placeholder entity marks, including optional tracks and ride footprints, with viewport culling.
- [projection.ts](projection.ts) implements continuous fixed-point world projection, tile-coordinate rotations, view dimensions, and `pickTile`, which maps viewport coordinates to the highest tile diamond under the pointer.

### Things to Know

- `MapData` is sent separately from snapshots and contains dimensions plus height and surface arrays. Entity positions use the snapshot's four-integer stride; renderers unpack these values rather than holding simulation objects.
- Sprite art and terrain styling are generated at runtime. This keeps rendering independent of original game assets and external art files.
- WebGL2 context loss pauses drawing until restoration rebuilds GPU resources. Initial context or resource setup errors trigger the Canvas2D fallback through [create-renderer.ts](create-renderer.ts).
- Picking accounts for camera zoom, rotation, and map elevation. It is used for selection and tool feedback; it does not itself issue a simulation command.

Created and maintained by Nori.
