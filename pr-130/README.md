# PR 130 proof: flat ride proportions

In-park captures at default zoom, desktop (1280x800; lineup 2400x1100), 4 rotations (r0-r3), WebGL2 and Canvas2D.
Scenes are built programmatically with the sim API (`tools/build-scenes.mts`) and imported as saves; `tools/capture.mts` captures them.
`before/` = main, `after/` = PR branch. Scenes: merry-go-round, enterprise, ferris-wheel, top-spin, swinging-ship (each beside a path with guests, a stall and trees) and `lineup` (all nine flat rides with guests beside each).
