# PR #139 proofs: universal per-pixel occlusion

Captured 2026-10-26 in headless Chromium (SwiftShader) from `/occlusion-fixture.html` (a fuzzed park built through real sim commands). **before** is commit e3847b8: main's draw order plus the object-ID capture only. **after** is the PR branch.

- `*-highlight.png`: zoom 2, rotation 0, WebGL2, cropped close-up of each owner-report scene, before vs after.
- `<scene>-zoom<1|2>-sheet.png`: all four rotations (rows) × [WebGL2 before, WebGL2 after, Canvas2D before, Canvas2D after] (columns).
  - Scenes: `entrance-clipping` (ride entrance with guests), `exit-clipping` (ride exit with guests), `park-gate` (crowd walking through the gate), `coaster-rotation` (coaster station beside a plaza), `crowded-park` (dense park, seed 2).
- `oracle-heatmaps-seed1-zoom1.png`: oracle diff heatmaps for seed 1 at zoom 1, rotations 0-3. Red marks pixels where the renderer shows a different object than the mesh z-buffer oracle; yellow marks pixels where the renderer shows a kind that does not cover that pixel. Columns: WebGL2 before, WebGL2 after, Canvas2D after. There is no Canvas2D "before" heatmap because main's Canvas2D has no object-ID capture.
