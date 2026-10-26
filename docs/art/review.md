# Art review

Generated contact sheets live in `docs/art/review/` while the audit runs locally. PNGs are ignored by Git because the full matrix is large. The interactive viewer is [index.html](review/index.html).

## Capture scope

`pnpm art:review` places every catalog scenery item, path addition, path type, ride, stall, and facility on a test map. It captures the default and maximum zoom in four rotations for Canvas2D and WebGL2. Flowerbed sheets also capture zoom 0.5 and 2 on flat and sloped ground beside grass and a path, plus a legacy comparison. A separate garden fixture places a continuous bed row and 2×2 cluster beside a path with a guest and bin in all four rotations; its pixel check compares the adjacent path with and without beds.

Severity: **high** means the art is broken or hard to identify during ordinary play; **medium** means a visible scale, alignment, or readability issue; **low** means a minor polish issue.

## Findings

### High

- **Coaster and track rides:** Wooden Coaster, Steel Looping Coaster, Log Flume, River Rapids, Miniature Railway, Monorail, Chairlift, and Junior Roller Coaster render as a short red zigzag instead of recognizable ride art in WebGL2, at both default and maximum zoom. Follow up with ride sprite/model coverage.
- **Food Stall:** the stall is a lone blue pixel at both zooms in both renderers, so it is not identifiable during play. Add or connect readable stall art.

### Medium

- **Benches:** at default zoom the Bench and Vandalised Bench collapse into a few brown pixels and read as tangled sticks; at maximum zoom the wooden form is clearer. Improve the small-scale silhouette.
- **Lamps:** the coordinator reports that two rotations show the lamp lying sideways. In the current audit sheets, the post reads upright at maximum zoom in both renderers, but the vandalised variant has a detached red piece at its foot. Recheck the two reported rotations in the live build and correct the directional variants if the issue remains.
- **Source-sheet residue:** a trunk-like fragment reported above a flowerbed comes from prepared prop-sheet slicing and is separate from the generated flowerbed model and tile surface. Other isolated pixels at atlas sprite edges are reviewed with the relevant source or packer path.
- **Shrub:** the sprite is a very small green tuft even at maximum zoom, with a detached pixel above it. Increase its readable foliage footprint and remove stray edge pixels as part of the atlas cleanup.
- **Queue path:** dark, noisy pixels cover the queue surface instead of a clean, readable path texture. Review the queue-path art with the queue rendering work.

### Low

- **Vandalised lamp:** a detached red piece at the base is visually disconnected from the post and reads like a stray pixel. Confirm whether this is intended broken-lamp art when the orientation variants are checked.

Flowerbed frames contain a soil surface fitted to the tile's terrain triangles, thin low edging, and compact flowers in four color variants. Slope-specific art follows the tile's four corner heights. Placed beds and previews use the tile-centre ground pivot and native frame size; bed depth remains attached to the source tile so neighboring paths and people sort around it. The garden fixture checks the path beside a bed row in both renderers and all rotations, while the generated-art anchor test checks the opaque frame pixels against the projected tile surface.
