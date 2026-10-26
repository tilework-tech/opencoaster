# Art review

Generated contact sheets live in `docs/art/review/` while the audit runs locally. PNGs are ignored by Git because the full matrix is large. The interactive viewer is [index.html](review/index.html).

## Capture scope

`pnpm art:review` places every catalog scenery item, path addition, path type, ride, stall, and facility on a test map. It captures the default and maximum zoom in four rotations for Canvas2D and WebGL2. Flowerbeds also capture zoom 0.5 and 2, with flat and sloped ground beside grass and a path, plus a legacy comparison.

Severity: **high** means the art is broken or hard to identify during ordinary play; **medium** means a visible scale, alignment, or readability issue; **low** means a minor polish issue.

## Findings

### High

- **Coaster and track rides:** Wooden Coaster, Steel Looping Coaster, Log Flume, River Rapids, Miniature Railway, Monorail, Chairlift, and Junior Roller Coaster render as a short red zigzag instead of recognizable ride art in WebGL2, at both default and maximum zoom. Follow up with ride sprite/model coverage.
- **Food Stall:** the stall is a lone blue pixel at both zooms in both renderers, so it is not identifiable during play. Add or connect readable stall art.

### Medium

- **Benches:** at default zoom the Bench and Vandalised Bench collapse into a few brown pixels and read as tangled sticks; at maximum zoom the wooden form is clearer. Improve the small-scale silhouette.
- **Lamps:** lamp orientation is inconsistent in two rotations and appears sideways in the rotated views. Check the lamp and vandalised-lamp sprites and correct their directional variants.
- **Atlas bleed:** isolated neighboring-cell pixels appear above the topiary and stone fence, and at sprite edges elsewhere (including the flowerbed trunk-like speck reported during review). These are packer/renderer artifacts; the separate atlas-bleed work is addressing them.
- **Shrub:** the sprite is a very small green tuft even at maximum zoom, with a detached pixel above it. Increase its readable foliage footprint and remove stray edge pixels as part of the atlas cleanup.
- **Queue path:** dark, noisy pixels cover the queue surface instead of a clean, readable path texture. Review the queue-path art with the queue rendering work.

### Low

- **Vandalised lamp:** a detached red piece at the base is visually disconnected from the post and reads like a stray pixel. Confirm whether this is intended broken-lamp art when the orientation variants are fixed.

The flowerbed redesign is full-tile and remains flush to flat and sloped ground across the captured renderers, zoom levels, and rotations. The planted bed reads at default zoom; the smallest 0.5 zoom is naturally less detailed. The flowerbeds have a raised, bordered soil bed and dense colorful planting, in keeping with the game's pixel-art scale. The small trunk-like fragment visible in some captures is tracked above as atlas bleed, not part of the flowerbed model.
