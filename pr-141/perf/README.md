# PR 141 rendering performance and rain captures

## Scene and method

Seed 1 dense fuzz park, 1280×800 CSS viewport, zoom 1, rotation 0, rain overlay enabled. DPR is set to 1 or 2 for each run. The WebGL2 comparison changes only the terrain-depth instance append path; simulation data, assets, renderer, and fixture are otherwise aligned. Each case warms 60 frames and measures nine batches of 20 frames. The reported frame value is the median of the nine batch medians; WebGL2 calls `gl.finish()` before recording each completed-frame sample.

The owner-reported pre-#139 WebGL2 range was 2.56–2.81 ms; #139 raised it to 3.34–3.51 ms on the owner’s machine. This session’s SwiftShader timings use a different machine, so compare these values as a directional cross-machine check, not a controlled owner-machine rerun.

## WebGL2: before vs after depth-pass optimization

| DPR | Completed frame median | Draw CPU median | Depth-only terrain CPU | Sprite submission CPU | Renderer CPU frame |
|---:|---:|---:|---:|---:|---:|
| 1 before | 1.56 ms | 1.69 ms | 0.535 ms | 0.020 ms | 2.085 ms |
| 1 after | 1.32 ms | 1.30 ms | 0.130 ms | 0.020 ms | 1.655 ms |
| 2 before | 1.76 ms | 1.74 ms | 0.880 ms | 0.020 ms | 1.945 ms |
| 2 after | 1.29 ms | 1.25 ms | 0.130 ms | 0.020 ms | 1.670 ms |

`ground colour cache` CPU median remained 0.005 ms in all four WebGL2 cases. The optimized completed-frame medians are below the owner-reported pre-#139 range, with the terrain-depth CPU pass reduced by 76% at DPR1 and 85% at DPR2.

## Canvas2D and weather

The Canvas2D renderer itself was not changed by this optimization. Its measured depth-composite/writeback CPU medians in the paired capture were 24.99/0.56 ms at DPR1 before and 25.27/0.55 ms after; at DPR2 they were 28.08/1.21 ms before and 28.29/1.22 ms after. These CPU-only method timings varied across fresh browser processes, so they are not used as a Canvas2D performance claim. A later isolated capture measured 12.59/0.50 ms at DPR1 and 27.90/1.19 ms at DPR2.

The CSS rain overlay is outside `renderer.draw()`. Median RAF interval was 16.665 ms with rain and 16.665 ms after removing the overlay in the same page.

## Rain screenshots

All captures show the same busy seeded park at default zoom in rain, in both renderers and DPRs:

- [WebGL2 DPR1 before](before/webgl2-dpr1.png) · [after](after/webgl2-dpr1.png)
- [WebGL2 DPR2 before](before/webgl2-dpr2.png) · [after](after/webgl2-dpr2.png)
- [Canvas2D DPR1 before](before/canvas2d-dpr1.png) · [after](after/canvas2d-dpr1.png)
- [Canvas2D DPR2 before](before/canvas2d-dpr2.png) · [after](after/canvas2d-dpr2.png)

Fence visibility captures for the coaster crossing the park boundary and straight guest-adjacent boundary run are in the parent `before/` and `after/` directories. They cover all four rotations in WebGL2 and Canvas2D.
