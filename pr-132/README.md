# PR 132 proof: bench / bin / lamp at RCT2 proportions

Default zoom, 4 rotations (r0-r3), WebGL2 (Chromium swiftshader) and Canvas2D (WebGL forced off), desktop 1280x800 and Pixel 8.
Scenes are built with the sim API (`tools/build-path-scenes.mts`) and imported as saves; `tools/capture2.mts` captures them. `before/` = main (fbaa9ea), `after/` = PR branch.
Scenes: `busy-straight` (22 tiles, benches/bins/lamps, some vandalised, 9 guests), `t-junction`, `dead-end`, `closeup` (guest beside each prop; `*-crop2x.png` is a 2x nearest-neighbour crop of the same frame).
Not shown: guests sitting - the sim has no sitting state, so guests are only walking/standing.
