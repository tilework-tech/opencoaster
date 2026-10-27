# PR 148 v2: trench entries

Old = commit ae3cff5 (headwall on a mound). New = this branch at c51b0c1: track below the ground is drawn in a real cut in the terrain (floor, two retaining walls, arch headwall), the same for hillside entries.

- `sheets/closeups-<variant>-<renderer>.png`: per rotation, OLD 1x | NEW 1x | OLD 2x | NEW 2x. NEW crops the headwall that faces the camera; a guest stands beside each headwall for scale.
- `sheets/whole-old|new-<variant>-<renderer>.png`: the whole tunnel in four rotations.
- `raw/`: every capture (`new-<renderer>-<variant>-closeup-zoom<1|2>-rot<N>.png`, `...-whole-rot<N>.png`). WebGL2 is a page screenshot; Canvas2D is read with `canvas.toDataURL`.
- Variants: `cut` (flat ground), `slope` (one-level hill), `face` (steep hill).
