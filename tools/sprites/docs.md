# Noridoc: 3D sprite renderer

Path: @/tools/sprites

### Overview

- Dev-time tool that renders game art from original 3D models: paths, water, flat rides, stalls, coaster track and train cars. It runs headless in Node (no GPU, browser or image-generation service) and is deterministic: the same code produces the same pixels.
- Output is PNG/JSON pairs in the format [tools/art](../art/README.md) packs. `tools/art/prepare.ts` calls `renderSprites` after clearing `public/sprites/`, then `pack-cli.ts` packs everything into the shared atlas and `manifest.json`.
- `pnpm sprites:render` writes review contact sheets to `docs/art/contact-sheet-*.png`, one per top-level key group (`paths`, `water`, and any new group).

### How it fits into the larger codebase

- Runtime lookup of the generated keys lives in [src/render/world-art.ts](../../src/render/world-art.ts), including ride type, camera view, and animation frame selection. Both renderers read the shared manifest and atlas; Canvas2D uses [canvas-atlas.ts](../../src/render/canvas-atlas.ts).
- Sprites rendered by [output.ts](output.ts) carry `"native": true` in their JSON and manifest entry: the renderer draws them at atlas frame size and puts the `anchor` pixel on the projected world point instead of stretching them into a fixed quad. Textures (`raw: true`, e.g. water) carry no `native` flag and are mapped onto the terrain mesh by the renderer.
- [generate.test.ts](generate.test.ts) checks path masks and ramps, water frames, and every gentle or thrill flat ride across four views with idle and occupied animation poses and matching tile footprints.

### Core Implementation

- [raster.ts](raster.ts) is a small software rasterizer: exact 2:1 dimetric orthographic projection (`sx = (x - y) * 32`, `sy = (x + y) * 16 - z * 16`, so a tile is the classic 64x32 diamond with rows 2, 6, ... 62, 62, ... 2 and one height level is 16px), a z-buffer (larger `x + y + 2z` is nearer), per-face flat shading from a fixed upper-left light into five ramp levels, no anti-aliasing, and an optional 1px dark outline.
- [palette.ts](palette.ts) defines the fixed warm palette: named five-shade ramps (`ramp('asphalt')`, ...) plus an eight-colour water cycle. Sprites hold palette indices only, so every pixel is a palette colour.
- [mesh.ts](mesh.ts) holds the primitives (`box`, `cylinder`, `beam`, `quad`, `polygon`, `loft`), transforms (`translateMesh`, `rotateZ`, `rotateY`, `rotateMesh` by camera quarter turns) and `clipMesh`.
- [models/paths.ts](models/paths.ts): tarmac, crazy paving, dirt and queue (with rails). 16 connection masks and 4 ramps per style; kerbs are drawn only on unconnected sides and no end caps are drawn so neighbours join seamlessly; surface patterns are periodic per tile.
- [models/water.ts](models/water.ts): `water/surface`, a square 32x32 tile-space texture in eight frames that differ only by palette cycle (the renderer maps it onto the terrain mesh). The renderer, not this tool, draws the bank: it lowers the surface by `WATER_BANK.surfaceInset`, clips water where terrain is above it and shades by depth below the surface (foam line, shallows, deep water).
- [models/ride-catalog.ts](models/ride-catalog.ts) combines shared ride meshes with detailed models. Flat rides use frame 0 for an empty idle pose and frames 1–8 for occupied operation; ride footprints are copied from the simulation catalog into the manifest.
- Keys: `paths/<style>/connection-XX` (XX = hex connection mask, bit d = world direction d) and `paths/<style>/ramp-N` (rises toward direction N), `water/surface#frame`, `flat-rides/<slug>/view-N`, `stalls/<slug>/view-N`, and `transport/<slug>/view-N`.

### How to add a new model

1. Write a function returning a `Mesh` (an array of triangles) in `models/<name>.ts`. Coordinates are `[x, y, z]`: `x` and `y` in tiles with the model origin at the centre of its origin tile (`+x` is down-right on screen, `+y` down-left), `z` in height levels (16px each; one level is a quarter of a tile on the simulation side, so a solid cube a tile tall is about 2.45 levels in the view - author in tile units and convert with `physicalToLevels` from [mesh.ts](mesh.ts) when you want physically proportioned objects). `z = 0` is the surface of the tile the model stands on.
2. Colour faces with `material(ramp('name'))` (see [palette.ts](palette.ts); add ramps there if needed, keeping the palette at most 256 entries). Face shade comes from the normal, so use real geometry for shading rather than painted shading. `material(ramp, { shader })` can replace the colour per pixel from the model-space position (use periodic functions of tile-local coordinates for patterns that must tile).
3. Render with `renderMesh(mesh, { outline })`. Use `outline: true` (the default) for free-standing objects such as rides and `outline: false` for ground tiles that must join their neighbours. The result is a `Sprite`: palette-index pixels, even width and height, and `anchor = { x, y }`, the pixel of the model origin. The anchor is always on the centre column, so the renderer can centre the quad.
4. Rotations: build the model once and call `rotateMesh(mesh, view)` for `view` 0 to 3 before rendering; this turns the model about the origin by quarter turns in the same sense as the camera's `rotation`, so `view = (object direction + camera rotation) & 3` selects the right sprite. Rotate the mesh, never the light: the light stays fixed on screen. For a footprint larger than one tile, set the origin at the centre of the origin tile and use `clipMesh` plus `translateMesh` to cut one sprite per tile column so the renderer can paint in tile order.
5. Frames: return one `Sprite` per animation frame and put them in `SpriteDef.frames` (all frames of a def are padded onto one canvas with a shared anchor by `alignFrames`). Animate by changing the mesh (rotate parts, move riders) or, for water-like effects, a palette cycle (`waterColor(slot, frame)`); keep loops closed by choosing symmetric steps (for example eight identical gondolas move 45 degrees over the loop).
6. Register in [generate.ts](generate.ts): push `{ key, frames, footprint: { width, height } }` (footprint in tiles) onto the list returned by `buildSprites()`. The key is the manifest key; `/view-N` and `#frame` conventions are selected by [world-art.ts](../../src/render/world-art.ts). Use `raw: true` only for square textures that the renderer maps itself.
7. Add a coverage test to [generate.test.ts](generate.test.ts), run `pnpm sprites:render` and look at `docs/art/contact-sheet-<group>.png`, then `pnpm art:prepare && pnpm art:pack` and check the manifest. Wire the key into the renderers through `world-art.ts`.

### Things to Know

- Atlas size: `tools/art/pack.ts` caps the atlas at 1024x2048 and packs identical frames once; large sprite families must account for that budget.
- The smoke test `smoke/terrain-visual.spec.ts` recognises water by colour (blue well above red and green), so the water ramp must stay saturated blue.
- A rendered sprite with an outline is one pixel larger on each side than the geometry; ground tiles are not outlined.

Created and maintained by Nori.
