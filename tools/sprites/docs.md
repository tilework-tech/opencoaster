# Noridoc: 3D sprite renderer

Path: @/tools/sprites

### Overview

- Dev-time tool that renders footpaths, water, flat rides and stalls, coaster track, supports and train cars from original 3D models into sprites. It runs headless in Node (no GPU, browser or image-generation service) and is deterministic: the same code always produces the same pixels.
- Output is a set of PNG/JSON pairs in the format [tools/art](../art/README.md) packs. `tools/art/prepare.ts` calls `renderSprites` into the gitignored `tools/sprites/.build/`, and `pack-cli.ts` packs that directory together with `public/sprites/` into the shared atlas and `manifest.json`.
- `pnpm sprites:render` writes review contact sheets to `docs/art/contact-sheet-*.png` (one per group; track sheets show cell 0 of view 0 of every piece).

### How it fits into the larger codebase

- [src/render/sprite-art.ts](../../src/render/sprite-art.ts) is the runtime counterpart: it maps ride types, track pieces and path masks to the keys this tool emits. [generate.test.ts](generate.test.ts) covers path masks, catalog track pieces for both styles and four views, ride and stall sprites, and car headings. Its dedicated flat-ride case derives the gentle and thrill ride set from the simulation catalog and checks all four views, an idle frame, eight distinct operating frames, and aligned dimensions and anchors.
- Track sprites are generated from the simulation's own `PIECES`/`SAMPLES` tables in `src/sim/track/catalog.ts`, so any new catalog piece gets sprites automatically.

### Core Implementation

- [raster.ts](raster.ts) is a small software rasterizer: exact 2:1 dimetric orthographic projection (`sx = (x - y) * 32`, `sy = (x + y) * 16 - z * 16`, so a tile is the classic 64x32 diamond with 2px-stepped rows and a height level is 16px), a z-buffer, per-face flat shading from a fixed upper-left light into five ramp levels, no anti-aliasing, and an optional 1px dark outline. Sprites have even dimensions and the anchor on the centre column; the anchor is the model origin (tile centre at the piece's base height).
- [palette.ts](palette.ts) defines the fixed warm palette: named five-shade ramps plus an eight-colour water cycle. Sprites hold palette indices only, so every pixel is a palette colour.
- [mesh.ts](mesh.ts) holds primitives (box, cylinder, beam, quad/polygon), rotation by camera quarter-turn, and clipping to a tile column. Rides are authored in physical tile units and converted with `PHYSICAL_Z`; track is authored with the catalog's height levels.
- [models/](models) contain the content: path and water meshes, coaster geometry, and ride models. [ride-catalog.ts](models/ride-catalog.ts) combines the base models with per-ride modules; the detailed flat-ride models provide an empty idle pose and occupied operating poses. Ride meshes are rendered in four camera rotations, while coaster track is split by footprint cell for tile-order drawing.
- Keys: `paths/<style>/connection-XX|ramp-N`, `water/surface` (8 frames), `water/shore/shape-XX`, `rides/<slug>/view-V#frame`, `track/<style>/<piece>/view-V/cell-N`, `track/<style>/support-column|support-base/view-V`, `vehicles/<style>/car/<pitch>/heading-H`. For flat rides, frame 0 is idle and subsequent frames are generated operating poses; runtime chooses among them from ride phase and simulation tick.
- Track pieces are split per footprint cell so the renderer can paint them in tile order; cell `N` is the N-th entry of the piece's `footprint`, and `V` is `(piece dir + camera rotation) & 3`.

### Things to Know

- Sprites are 1:1 pixel art at the game's native scale; the renderer must draw them at their atlas frame size and align `anchor` to the projected point rather than stretching them into a fixed quad.
- Water animation is a palette cycle: all eight frames share one ripple pattern and differ only by which palette slot each pixel shows.
- Clipping a swept beam to a tile column leaves the cut open; the neighbouring cell's sprite covers the join.
- The atlas is capped at 2048x4096 (the runtime adds a 512px fallback strip, so the combined texture needs `MAX_TEXTURE_SIZE >= 4096`); the packer stores identical frames once.

Created and maintained by Nori.
