# PR 151 proof: WebGL land overlay no longer tints support bases

Fixture: seed 1, rotation 0, zoom 1, land overlay on (land tool open), 800x600, crop (480,478) 84x66 at 8x.
Supports stand on the dark overlay tiles with gold ownership dots. `before` = main, `after` = PR 151.

- `crop-webgl2-side-by-side.png`: before (left) / after (right). The support footing pads are tinted by the overlay before and untinted after.
- `crop-canvas2d-side-by-side.png`: identical before and after (Canvas2D already drew the overlay as ground).
- Individual `crop-<renderer>-before|after.png` files.
