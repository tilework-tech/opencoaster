# PR 145 v2: trains park at the platform front on circuits closed at the station

New = `fix/train-car-settings` at a696413, rebased on main 0c6708d (#151). Old = main 0c6708d.

Both coasters (Wooden Coaster, Steel Looping Coaster) were built through the UI on Open Grounds with the circuit **closed at the station**: the first piece is a flat straight, the Station is placed last. The chain lift (flat, up, flat) sits right after the platform; the rest is the usual 14-piece oval. Then entrance, exit, test lap, a path to the park entrance, Open, and the dev-build "Guests +1,000" button so guests queue. Game speed 1x, camera follows the train at zoom 2.

- WebGL2 frames are page screenshots of the game canvas. Canvas2D frames are read with `canvas.toDataURL`. the Canvas2D canvas is half resolution in the follow frames, so those crops are 280x170 and are upscaled here with nearest-neighbour.
- Every capture waits until all sprite atlas requests have finished (`coaster-steel` or `coaster-wood`, `people`, `world`) plus 4 s. UI windows, tile overlays and the tool status are hidden with CSS for the frames.
- Rain in some frames is the game's weather, not part of the change.

## Sheets

| file | what it shows |
| --- | --- |
| `sheets/after-steel-webgl2.png`, `after-steel-canvas2d.png`, `after-wooden-webgl2.png`, `after-wooden-canvas2d.png` | PR 145. 1 ride closed, train at the platform front. 2 open, loaded, ready. 3 departing. 4 climbing the chain lift. 5 top of the lap. 6 descending. 7 returning. 8 back at the platform with guests queueing at the entrance. |
| `sheets/before-after-steel-webgl2.png`, `before-after-wooden-webgl2.png`, `before-after-steel-canvas2d.png` | Top row main, bottom row PR 145, same four moments (closed after test, open and waiting, loaded, departing). On main the train waits on the last piece, 0.8 to 0.9 tiles behind the platform centre, left of the station roof; guests board it there. With the PR it waits under the roof, 0.1 to 0.2 tiles from the platform centre. |
| `sheets/repair-on-load-steel-webgl2.png`, `repair-on-load-wooden-webgl2.png`, `repair-on-load-steel-canvas2d.png` | A park saved by main with the train parked on the last piece, loaded on PR 145. First two frames: main, train behind the platform (the frames just before the save was exported). Remaining six: PR 145 after loading it: train at the platform front, boards, departs, climbs the lift, mid-lap, returns. |

`raw/<run>/` holds every frame used. Run names: `mainc-*` main, `headc-*` PR (WebGL2, with guests); `headg-*` PR (Canvas2D, with guests); `mainp-*` main run whose save was exported with the train parked; `headload3-*` PR after loading that save; `main-steel-Canvas2D-build` main (Canvas2D, no extra guests).

## What I did not see

- On main the train was not permanently stuck in these captures. With 1000 guests it kept cycling; with about 40 guests it waited at the platform for about 2,000 ticks between laps, on the PR as well. The visible defect on main is the wrong parking spot on the last piece. If a permanently stuck train needs a different save or scenario, say so.
- The Canvas2D "before" frames (and the first two frames of `repair-on-load-steel-canvas2d.png`) come from a separate main run, not from the save that was loaded.
- Guest uptake is low on both coasters (excitement 1.05 wooden, 1.26 steel), so about one rider boards per dispatch.

`tools/` has the capture spec (`proof-pr145.spec.ts`, env `PROOF_OUT`, `PROOF_KIND`, `PROOF_BACKEND`, `PROOF_MODE=build|load`, `PROOF_EXPORT`, `PROOF_SAVE`, `PROOF_GUESTS`), the queue scripts and the strip builders.
