# World art pipeline

The art pipeline keeps OpenCoaster independent of original game files and copied code. The committed source sheets under [source/](source/) are newly generated artwork; their generation prompts are kept in [prompts/](prompts/). Normal development and production builds consume these saved sheets and do not call an image-generation service.

## Preparation

[prepare.ts](prepare.ts) clears and recreates `public/sprites/`, then crops, trims transparent padding, resizes with nearest-neighbour sampling, and quantizes images to a deterministic 64-colour palette. Per-sprite JSON records frame rectangles, bottom-centre anchors, and tile footprints. [pack.ts](pack.ts) validates that metadata, sorts sprite frames by dimensions and stable key, packs them into a transparent PNG atlas, and writes the frame locations and metadata to `manifest.json`. The generated atlas is capped at 3072 pixels wide by 4096 pixels high; packing fails if a source sprite or packed result exceeds those limits. The width cap leaves room for the procedural fallback atlas when WebGL combines both textures, keeping each combined dimension within WebGL2's 2048-pixel minimum texture-size guarantee.

The terrain sheet supplies four source crops per material. Preparation cycles and reflects those crops to produce the 19 named `shape-00` through `shape-12` variants for grass, sand, dirt, and rock. They are deterministic derivatives of the source sheet, not 19 individually generated terrain geometries. The simulation currently publishes a 4-bit slope mask, so the renderer selects only `shape-00` through `shape-0f`; the remaining names are not currently addressable from map data.

Footpaths, water, flat rides, stalls, coaster track and train cars are not prepared from source sheets: [tools/sprites](../sprites/docs.md) renders them from 3D models, and `prepare.ts` writes them to `tools/sprites/.build/` for packing alongside the generated sheets. The props sheet is cropped into trees and park scenery; its saved prompt and source image remain the reproducible inputs.

Run `pnpm art:prepare` to regenerate the individual PNG/JSON pairs, then `pnpm art:pack` to build the atlas and manifest (frames with identical pixels share one atlas region; the atlas is at most 3072x4096). The `predev` and `prebuild` hooks run both steps automatically. `public/sprites/` is generated output; make source-sheet or prompt changes in `source/` and `prompts/`, then regenerate the output.
