# PR 138 proof: RCT2-quality wall scenery (hedge, stone fence, wooden fence)

before = main (1166074), after = PR head (db7c490). Scenes built via the sim API and imported as saves (tools/build-wall-scenes.mts); desktop 1280x800, default zoom, WebGL2 (SwiftShader) and Canvas2D, rotations r0-r3, guests beside every wall. `*-crop2x.png` are 2x nearest-neighbour close-ups of the centre.
Scenes: hedge-maze, hedge-maze-slope, wood-enclosure, wood-enclosure-slope, stone-enclosure, stone-enclosure-slope, four-edges (all four edge orientations of each style on one tile).
Scripts: tools/ (capture2.mts runs from inside the repo checkout).
