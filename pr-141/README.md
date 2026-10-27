# PR #141 park boundary fence visibility captures

Seed 1, default zoom (zoom 1), 1280x800. The `coaster` scene has the wooden coaster and tall supports crossing the park boundary. The `gate` scene is centered on the entrance, with guests along a straight boundary run nearby. Rows are rotations 0–3; each scene has both renderers.

Before captures use the 0.20-tile park fence. After captures use 0.30 tiles. Canvas2D files were captured with `canvas.toDataURL('image/png')`; WebGL2 files are page screenshots. All captures use the same fixture and camera settings.

Files are named `<scene>-<renderer>-rot<rotation>.png` inside `before/` and `after/`.

The earlier PR #139 sheets show the same coaster-boundary scene in four rotations for both renderers; the `before` columns are also available at `../pr-139/boundary-coaster-zoom1-sheet.png`. These are reference captures from the universal-occlusion change.
