# PR #116 visual proof

Saved-park scenes (one imported save) captured in WebGL2 (SwiftShader) and Canvas2D, on desktop (1280x800) and Pixel 8, in all four rotations, on `main` (f71db24, before) and the PR branch (after).

- `contact-sheets/<backend>-<device>-<shot>.png`: top row main, bottom row PR, columns rotation 0-3.
- `before-main/` and `after/`: full-resolution captures, `<backend>-<device>/<shot>-r<rotation>.png` (palette-quantised to keep the repo small).

Shots: trees-sheet, scenery-sheet (hedge, wooden/stone fence, shrub, flowerbed), additions (bench/bin/shelter/lamp, working and vandalised), trees-slope (oak/conifer on flat plateau and every slope shape, guests on adjacent tiles), fences-* (park boundary fence on flat, slope and corners; fence scenery on slopes), network (default zoom), in-context, in-context-close.
Ambient trees are suppressed in every capture so each scene is controlled. The sim is paused a few ticks after import; guest positions differ by a few ticks between runs.
