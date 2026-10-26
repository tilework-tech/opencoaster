# Art review

Generated contact sheets live in `docs/art/review/` while the audit runs locally. PNGs are ignored by Git because the full matrix is large. The interactive viewer is [index.html](review/index.html).

## Capture scope

`pnpm art:review` places every catalog scenery item, path addition, path type, ride, stall, and facility on a test map. It captures the default and maximum zoom in four rotations for Canvas2D and WebGL2. Track rides are built through the simulation's normal ride creation and `placeTrack` command path, then marked complete before capture. Their checks count opaque pixels for each track-piece sprite and reject the red procedural fallback marker. Flowerbed sheets also capture zoom 0.5 and 2 on flat and sloped ground beside grass and a path, plus a legacy comparison. A separate garden fixture places a continuous bed row and 2×2 cluster beside a path with a guest and bin in all four rotations; its pixel check compares the adjacent path with and without beds.

Every stall and facility is also compared against the same scene without it at default zoom, with a minimum visible-pixel threshold. A populated context scene (stalls, shrub clusters, benches, bins and lamps beside a path, guests, and a flowerbed on sloped ground) is captured in all four rotations at default zoom for neighbouring-tile overlap checks.

Set `ART_REVIEW_ITEMS` to a comma-separated list of label fragments (for example `shrub,bench,food stall`) to restrict the inventory sheets to matching items.

Severity: **high** means the art is broken or hard to identify during ordinary play; **medium** means a visible scale, alignment, or readability issue; **low** means a minor polish issue.

## Resolved in the placeable-art readability change

- **Benches:** the seat palette contrasts with the supports and backrest, keeping a readable silhouette at default zoom.
- **Facilities:** stall and facility sprites were redrawn for readable silhouettes. The Information Kiosk uses a consistent four-sided roof in every view.
- **Shrub:** generated art is a broader bush with four deterministic tile variants, each with camera views.
- **Vandalised lamp:** the detached ground shard was removed.

## Verified track-rendering findings

- **Harness-only lazy-page artifact:** Earlier sheets showed track rides as red marks and some lazy-category objects, including the Merry-Go-Round and Food Stall, as isolated pixels. The harness imported `sprite-pages` without the `.ts` extension while both renderers imported `sprite-pages.ts`. Vite treated those as separate module identities, so the harness loaded pages into a different `SpritePages` store from the one used by the renderers. The fixture now imports the canonical `.ts` module. The earlier marks do not establish that a completed ride or those objects render that way in the game.
- **Real transport track gap:** Normal circuits use `smallLeft` and `smallRight` pieces. Transport generation previously omitted every turned piece, leaving those cells to the procedural fallback in Miniature Railway, Monorail, and Chairlift track. The generated transport atlas now includes both small turns; [generate.test.ts](../../tools/sprites/generate.test.ts) checks their opaque pixels for every style and camera view. Larger turns and looping pieces remain outside the shared transport atlas set.
- **Regression coverage:** The art-review fixture places a complete circuit through `createCoaster` and `placeTrack`, uses the ride-specific water-lift mode where required, and checks track sprite pixels and the rendered fallback-marker color in Canvas2D and WebGL2. This keeps fixture construction and sprite-store identity aligned with the paths used by the game.

The previous track-ride and isolated lazy-category observations are withdrawn as in-game findings because they were captured with the duplicate sprite store. The verified transport turn omission was player-visible in circuits containing those pieces and is covered by the generator test above. Other visual findings below remain review observations and have not been retested as part of this track-rendering change.

## Flat-ride proportions

The following measurements come from the authored ride meshes, projected with the game's default 64×32 dimetric tile projection across all animation poses and four model orientations. They are reproducible geometry measurements, not measurements from an authentic RCT2 game capture. Projected width is the widest model envelope divided by the horizontal span of its rectangular footprint diamond; this comparison does not by itself prove that every pixel is inside the footprint boundary. Vertical height is the model's authored maximum z divided by the generated standing guest's 0.388-tile z-height. Capture-based screen measurements with guests and neighbouring scenery remain open.

| Flat ride         | RCT2 footprint | Projected model width / footprint span | Model height / guest height | Target                                                                                                                             |
| ----------------- | -------------: | -------------------------------------: | --------------------------: | ---------------------------------------------------------------------------------------------------------------------------------- |
| Merry-Go-Round    |            3×3 |                   128.5 / 192 px (67%) |                        3.4× | Canopy clearly inside the footprint, with a visible deck ring; about 3–4 guest-heights tall.                                       |
| Swinging Ship     |            1×5 |                   184.3 / 192 px (96%) |                        7.0× | Keep the swinging envelope within the long footprint, allowing only small eaves; retain the recognisable tall pendulum silhouette. |
| Ferris Wheel      |            1×4 |                   129.0 / 160 px (81%) |                        9.0× | Keep the wheel and supports within the narrow footprint; preserve the tall wheel silhouette.                                       |
| Twist             |            3×3 |                   128.5 / 192 px (67%) |                        2.8× | Keep the rotating arms and cars within the footprint; match the compact RCT2 ride silhouette.                                      |
| Haunted House     |            3×3 |                   170.9 / 192 px (89%) |                        5.4× | Keep the roof and walls within the footprint apart from small eaves; use a low building silhouette.                                |
| Spiral Slide      |            2×2 |                   124.2 / 128 px (97%) |                        7.1× | Keep the slide and stairs within the footprint; retain a narrow, raised slide silhouette.                                          |
| Top Spin          |            3×3 |                   176.0 / 192 px (92%) |                        8.0× | Keep the frame and rotating gondola within the footprint; retain its tall rectangular frame.                                       |
| Enterprise        |            4×4 |                   172.0 / 256 px (67%) |                        7.2× | Keep the wheel and supports within the footprint; retain its raised rotating wheel silhouette.                                     |
| Observation Tower |            1×1 |                     38.7 / 64 px (60%) |                       11.3× | Keep the tower base within its tile; retain a slender tower proportion.                                                            |

The Merry-Go-Round canopy diameter is 1.92 tiles against its 3-tile footprint width, leaving visible platform around it in plan. The broad height differences among ride types are intentional silhouette differences; the 3–4 guest-height target applies to the Merry-Go-Round reference observation, while other rides are compared qualitatively with their RCT2 silhouettes. These figures should not be read as measurements of the original game. References for the RCT2 scale and ride forms: [RCT2 manual](https://rct2.rctspace.com/rct2_manual.pdf), [RCT2 editor FAQ](https://www.interactivitiesink.com/rct2/editor/faq.html), [RCT2 building tutorial](https://ae.rctspace.com/tutorial/ch02.htm), and [Merry-Go-Round guide](https://outof.games/realms/rollercoastertycoon/guides/496-guide-to-building-a-merry-go-round-in-roller-coaster-tycoon-1-2/).

### Medium

- **Lamps:** the coordinator reports that two rotations show the lamp lying sideways. In the current audit sheets, the post reads upright at maximum zoom in both renderers. Recheck the two reported rotations in the live build and correct the directional variants if the issue remains.
- **Atlas bleed:** isolated neighboring-cell pixels appear above the topiary and stone fence, and at sprite edges elsewhere (including the flowerbed trunk-like speck reported during review). These are packer/renderer artifacts; the separate atlas-bleed work is addressing them.
- **Queue path:** dark, noisy pixels cover the queue surface instead of a clean, readable path texture. Review the queue-path art with the queue rendering work.

Flowerbed frames contain a soil surface fitted to the tile's terrain triangles, thin low edging, and compact flowers in four color variants. Slope-specific art follows the tile's four corner heights. Placed beds and previews use the tile-centre ground pivot and native frame size; bed depth remains attached to the source tile so neighboring paths and people sort around it. The garden fixture compares adjacent path pixels with and without a bed row in both renderers and all rotations; the generated-art anchor test checks opaque frame pixels against the projected tile surface. The trunk-like fragment above the flowerbed is tracked with atlas artifacts, not as part of the bed model.
