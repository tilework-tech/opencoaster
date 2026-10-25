# Noridoc: 3D sprite renderer

Path: @/tools/sprites

### Overview

- Dev-time software rasterizer that builds original, clean-room footpath sprites and the lake water texture from small 3D models; it does not use original game art or copied game code.
- Writes PNG/JSON sprite pairs for [tools/art](../art/README.md) to pack into the runtime atlas. `pnpm sprites:render` also writes contact sheets for visual review.

### How it fits into the larger codebase

- [tools/art/prepare.ts](../art/prepare.ts) prepares generated terrain and prop source sheets, then runs this generator; [tools/art/pack.ts](../art/pack.ts) combines the results into `public/sprites/atlas.png` and its manifest before builds.
- [src/render/world-art.ts](../../src/render/world-art.ts) resolves runtime keys. WebGL2 samples the packed atlas directly, while Canvas2D loads it through [src/render/canvas-atlas.ts](../../src/render/canvas-atlas.ts).
- Native sprites such as paths retain their frame dimensions and anchor metadata. Raw tile textures such as water are mapped over terrain geometry by the renderers; the water bank and shoreline geometry are renderer responsibilities described in [src/render/docs.md](../../src/render/docs.md).

### Core Implementation

- [raster.ts](raster.ts) projects triangles into the 2:1 dimetric tile view, resolves visible pixels with a z-buffer, applies palette-index face shading, and optionally adds outlines. [mesh.ts](mesh.ts) provides the primitives, transforms, and mesh clipping used by models.
- [models/paths.ts](models/paths.ts) builds the original path connection and ramp sprites. [models/water.ts](models/water.ts) builds a periodic 32×32 tile-space texture with broad, low-contrast ripple shades; its eight frames shift those shades through the palette cycle for a gentle shimmer.
- [palette.ts](palette.ts) owns the shared sprite palette and closed water colour cycle. [output.ts](output.ts) writes PNG/JSON pairs and contact sheets with stable frame metadata.

### Things to Know

- Atlas pages: `tools/art/pack.ts` packs each category into its own pages of at most 2048x2048 with MaxRects, so a large ride or coaster family adds pages instead of exhausting one atlas. Category membership comes from the sprite key prefix in [tools/art/categories.ts](../art/categories.ts). Add a family by adding one rule there, for example `{ category: 'flat-rides', prefixes: ['rides/flat/'], lazy: true }`, then name keys under that prefix in `generate.ts`; `perSubdirectory: true` gives each directory under the prefix its own category (one per coaster family, `rides/coaster/<family>/...` becomes `coaster-<family>`). Lazy categories load the first time the renderer draws or is asked about one of their sprites (`spritePages.requestCategory(name)` from a build menu prefetches one); until then the renderer uses its procedural fallback. Keys matching no rule go to the eager `world` category.
- Trimming: sprites marked `native` (everything this tool renders) have transparent borders trimmed shared across their frames and the anchor shifted to match, so the packed frame is the tight box. Non-native sprites keep their frame size because the renderer stretches them to a fixed quad.
- The smoke test `smoke/terrain-visual.spec.ts` recognises water by colour (blue well above red and green), so the water ramp must stay saturated blue.
- A rendered sprite with an outline is one pixel larger on each side than the geometry; ground tiles are not outlined.
- Generated art is reproducible from repository-owned models, palettes, and source sheets. Do not use, commit, or derive assets from original commercial game files; the clean-room constraints are in [CONTRIBUTING.md](../../CONTRIBUTING.md).
- Water texture pixels are opaque and palette-indexed. The renderers apply translucency, depth shading, and terrain clipping at runtime; the texture generator does not model banks.
- Sprite families must fit the runtime atlas limit documented by [tools/art](../art/README.md). Adding a model requires registering its key in [generate.ts](generate.ts) and updating coverage in [generate.test.ts](generate.test.ts).

Created and maintained by Nori.
