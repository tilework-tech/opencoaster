# Noridoc: 3D sprite renderer

Path: @/tools/sprites

### Overview

- Renders the game's generated world art from small 3D models with a deterministic software rasterizer; generation runs at build time and does not require a browser or GPU.
- Produces PNG and JSON sprite definitions for [tools/art](../art/README.md), which prepares and packs them into the runtime atlas and manifest.
- `pnpm art:prepare` calls `renderSprites`, which writes every sprite from `buildSprites()` into `public/sprites/`. `pnpm sprites:render` only writes contact sheets under `docs/art/` for visual review.

### How it fits into the larger codebase

- [generate.ts](generate.ts) builds the sprite definitions consumed by [tools/art](../art/README.md); the asset preparation step clears generated output before rendering and packing, so each run creates one canonical set of sprite keys.
- [src/render/world-art.ts](../../src/render/world-art.ts) selects runtime keys and frames from ride type, state, camera direction, and tick. [src/render/coaster-art.ts](../../src/render/coaster-art.ts) shares coaster family, track-piece, vehicle-pose, and key conventions with generation.
- Both [renderers](../../src/render/docs.md) read the packed manifest. The `native` metadata emitted by [output.ts](output.ts) keeps rendered sprites at their source frame size and aligns their anchor to the projected world point; raw textures such as water are mapped by the renderer.
- [generate.test.ts](generate.test.ts) checks generated key coverage and model-specific sprite sets against simulation catalogs.

### Core Implementation

- [raster.ts](raster.ts), [mesh.ts](mesh.ts), and [palette.ts](palette.ts) define the dimetric projection, mesh operations, z-buffered shading, outlines, and fixed palette used by the model modules.
- [models/paths.ts](models/paths.ts) generates connection-mask and ramp variants. [models/water.ts](models/water.ts) generates palette-cycle texture frames. Their keys are consumed by the path and water paths in [src/render](../../src/render/docs.md).
- [models/ride-catalog.ts](models/ride-catalog.ts) supplies flat-ride models and catalog footprints. Each ride has four camera views; animated gentle and thrill rides include an idle frame and operating frames. [models/facilities/index.ts](models/facilities/index.ts), [models/stations.ts](models/stations.ts), and [models/park-entrance.ts](models/park-entrance.ts) generate stall/facility fronts, direction-aware entrance and exit huts, and the park gate. Station huts use category-specific post, roof, and sign palettes and a one-tile footprint; their current scale targets about one tile in width and roughly twice a guest's height as an approximate art direction guide, not a verified RCT2 measurement.
- [models/people.ts](models/people.ts) generates original low-poly staff figures. Each role has cardinal direction variants and two stride frames; guest character sheets use the separate `tools/art` processing pipeline.
- [models/go-karts.ts](models/go-karts.ts) supplies the detailed circuit and four kart poses used for Go-Karts, while other flat rides keep the selected models from the flat-ride catalog.
- [models/coaster/](models/coaster/sprites.ts) produces coaster track cells, supports, stations, and cars under family-specific keys. Track coverage follows each ride family's permitted simulation pieces; car variants encode heading, pitch, and bank to match [src/worker/car-poses.ts](../../src/worker/car-poses.ts).
- [models/trees.ts](models/trees.ts) supplies the palm and cactus ambient trees (`trees/tree-palm`, `trees/tree-cactus`), which are registered in [generate.ts](generate.ts) alongside the source-sheet trees and rendered by `pnpm art:prepare`. Their colours come from the existing green, wood and pink ramps.
- [models/transport.ts](models/transport.ts), the transport ride models, and [models/transport-track.ts](models/transport-track.ts) generate transport track cells and vehicles, alongside animated log-flume and river-rapids ride art. [generate.ts](generate.ts) registers the complete set, including facing/view variants for facilities and station huts.

### Things to Know

- [tools/art/categories.ts](../art/categories.ts) maps keys to separately packed atlas categories. People sprites are packed into the eager `people` category, while flat rides, stalls, facilities, transport ride art, transport tracks, and vehicles load lazily; `rides/coaster/<family>/...` keys map to lazy `coaster-<family>` categories. Track art under `track/<style>/...` is grouped by style. The key prefix is therefore part of the runtime loading contract.
- Coaster keys use `rides/coaster/<family>/track/...`, `support...`, `stations/...`, and `vehicles/...`; transport track and vehicle keys use `track/<style>/...` and `vehicles/<style>/...`. Flat ride animations use `rides/flat/<slug>/view-<view>` and facility sprites use `stalls/<slug>/facing-<facing>/view-<view>`.
- Multi-tile track pieces are clipped into tile-sized cells so renderers can preserve tile painter order. Model rotations change the camera view while keeping the lighting direction fixed; frame alignment preserves a shared anchor across animation poses. Generated staff frames encode cardinal facing in their sprite key; the runtime combines entity direction with camera rotation and selects the stride frame from simulation ticks. Guest frames are processed from project-owned source sheets by `tools/art`.
- Atlas packing trims transparent borders from native sprites and adjusts their anchors. Water remains a raw texture rather than a native anchored sprite, and its saturated blue palette is also recognized by [smoke/terrain-visual.spec.ts](../../smoke/terrain-visual.spec.ts).

Created and maintained by Nori.
