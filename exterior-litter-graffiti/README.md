# Exterior litter / graffiti: before vs after

Same save in both runs: `contaminated-sandbox-seed1.ocsave`. This is a seed-1 sandbox park, 96,135 ticks old (daytime, sunny), built on main bd724614, i.e. before the fix. Organic contamination: 40 guests ran for 96k ticks on main, so litter piled up along the edge approach. Controlled additions: three lamps on the x=63 path at y=100, y=108 (both on the approach, outside) and y=90 (inside the park), each marked broken. The "vandalised" visual is a broken path addition. The only graffiti-like sprites in the game are the broken bench/bin/lamp sprites and the litter sprites.

Gate is (63,95). The approach runs south to the map-edge spawn at (63,127).

| | before (main bd724614) | after (PR head) |
| --- | --- | --- |
| litter in loaded save, outside / inside | 29 / 3 | 0 / 3 |
| broken lamps at y=100, y=108 (outside) | 2 broken | repaired |
| broken lamp at y=90 (inside) | broken | still broken |
| litter after +150 guests at 8x (~7.5k ticks), outside / inside | 70 / 9 | 0 / 9 |

Screens, each pair taken from the same camera. `1/2/3` are right after load; `4/5/6` are after the traffic run. `1`/`4` frame the gate and the approach next to it, `2`/`5` the far approach, `3`/`6` the park side of the gate.
Stats are in `*-stats.json`: `final` is counted from the live worker snapshot. The `loaded` row is not reliable (it read a stale snapshot), so the loaded-save numbers in the table come from deserializing the save directly.

Reproduce: start `vite` on each checkout, then run `capture.spec.ts` with `SAVE=... LABEL=before|after OUT=... PORT=...` using `pw.config.ts`. It imports the save through the title screen. Rendering is headless Chromium with SwiftShader.
