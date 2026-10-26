# Art review

Generated contact sheets live in `docs/art/review/` while the audit runs locally. PNGs are ignored by Git because the full matrix is large. The interactive viewer is [index.html](review/index.html).

## Capture scope

`pnpm art:review` places every catalog scenery item, path addition, path type, ride, stall, and facility on a test map. It captures the default and maximum zoom in four rotations for Canvas2D and WebGL2. Track rides are built through the simulation's normal ride creation and `placeTrack` command path, then marked complete before capture. Their checks count opaque pixels for each track-piece sprite and reject the red procedural fallback marker. Flowerbed sheets also capture zoom 0.5 and 2 on flat and sloped ground beside grass and a path, plus a legacy comparison. A separate garden fixture places a continuous bed row and 2×2 cluster beside a path with a guest and bin in all four rotations; its pixel check compares the adjacent path with and without beds.

Set `ART_REVIEW_ITEMS` to a comma-separated list of label fragments (for example `shrub,bench,food stall`) to restrict the inventory sheets to matching items.

Severity: **high** means the art is broken or hard to identify during ordinary play; **medium** means a visible scale, alignment, or readability issue; **low** means a minor polish issue.

## Verified track-rendering findings

- **Harness-only lazy-page artifact:** Earlier sheets showed track rides as red marks and some lazy-category objects, including the Merry-Go-Round and Food Stall, as isolated pixels. The harness imported `sprite-pages` without the `.ts` extension while both renderers imported `sprite-pages.ts`. Vite treated those as separate module identities, so the harness loaded pages into a different `SpritePages` store from the one used by the renderers. The fixture now imports the canonical `.ts` module. The earlier marks do not establish that a completed ride or those objects render that way in the game.
- **Real transport track gap:** Normal circuits use `smallLeft` and `smallRight` pieces. Transport generation previously omitted every turned piece, leaving those cells to the procedural fallback in Miniature Railway, Monorail, and Chairlift track. The generated transport atlas now includes both small turns; [generate.test.ts](../../tools/sprites/generate.test.ts) checks their opaque pixels for every style and camera view. Larger turns and looping pieces remain outside the shared transport atlas set.
- **Regression coverage:** The art-review fixture places a complete circuit through `createCoaster` and `placeTrack`, uses the ride-specific water-lift mode where required, and checks track sprite pixels and the rendered fallback-marker color in Canvas2D and WebGL2. This keeps fixture construction and sprite-store identity aligned with the paths used by the game.

The previous track-ride and isolated lazy-category observations are withdrawn as in-game findings because they were captured with the duplicate sprite store. The verified transport turn omission was player-visible in circuits containing those pieces and is covered by the generator test above. Other visual findings below remain review observations and have not been retested as part of this track-rendering change.

### Medium

- **Lamps:** the coordinator reports that two rotations show the lamp lying sideways. In the current audit sheets, the post reads upright at maximum zoom in both renderers. Recheck the two reported rotations in the live build and correct the directional variants if the issue remains.
- **Atlas bleed:** isolated neighboring-cell pixels appear above the topiary and stone fence, and at sprite edges elsewhere (including the flowerbed trunk-like speck reported during review). These are packer/renderer artifacts; the separate atlas-bleed work is addressing them.
- **Queue path:** dark, noisy pixels cover the queue surface instead of a clean, readable path texture. Review the queue-path art with the queue rendering work.

Flowerbed frames contain a soil surface fitted to the tile's terrain triangles, thin low edging, and compact flowers in four color variants. Slope-specific art follows the tile's four corner heights. Placed beds and previews use the tile-centre ground pivot and native frame size; bed depth remains attached to the source tile so neighboring paths and people sort around it. The garden fixture compares adjacent path pixels with and without a bed row in both renderers and all rotations; the generated-art anchor test checks opaque frame pixels against the projected tile surface. The trunk-like fragment above the flowerbed is tracked with atlas artifacts, not as part of the bed model.
