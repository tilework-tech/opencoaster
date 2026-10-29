# PR #184 proof: guests sit on benches

Head tested: see the PR. Natural-use runs were captured on the sim code of the PR head except one later change (a seated guest no longer counts as the earlier guest at a blocked queue join, plus a test fixture fix); pose captures were re-run on the final head.

## What is here
- `natural-canvas2d/`, `natural-webgl2/`: a scripted park (balance park, seed 1, 2 months in; ordinary spawned guests, nothing edited) is imported into the running game, **10 benches are placed through the Scenery window > Benches tab with real clicks**, the game runs at 4x for about 30,000 ticks while the page's own snapshots are logged. `report.json` has the counts. Close-ups in all four rotations (`04-seat-rot*.png` are 6x nearest-neighbour crops, `seat-closeups-4-rotations.png` is the 2x2 sheet), full views (`03-view-rot*.png`), the benches just placed (`01-*`), the running park (`02-*`), a frame sequence of one guest walking to a seat, sitting and rising (`sequence/`, `sit-sequence-*.gif`).
- `pose-canvas2d/`, `pose-webgl2/`: **controlled fixture, not gameplay proof.** A plus-shaped path with a bench on each arm and 12 tired guests, so every seat orientation shows in every rotation in both renderers.
- `measurements/`: `perf*.txt` (sim benchmark main vs branch, incl. 600 benches / 5,000 tired guests), `bench-use-8mo.txt` (natural-use counts in the 8-month balance park), `balance-output.txt` (identical to main for a park without benches).
- `helpers/`: `bench-seating.spec.ts` + `playwright.proof.config.ts` (Playwright proof runner), `bench-use.ts`, and the crop / grid / GIF tools.

## Natural use, real UI
| | Canvas2D | WebGL2 |
|---|---|---|
| Park | 4 flat rides, stalls, toilets, 3 staff | same park with flat rides demolished (software WebGL2 runs out of memory with the 19 flat-ride atlas pages) |
| Benches placed through the UI | 10 of 10 | 10 of 10 |
| Simulated time after placing | 29709 ticks (12.4 min at 40 ticks/s) | 31961 ticks (13.3 min) |
| Guests in park at the end | 249 | 5 |
| Sitting sessions seen | 6 (5 completed, 6 distinct guests) | 5 (5 completed, 5 distinct guests) |
| Mean time seated | 22.1 s | 27 s |

Natural use is not frequent in the 250-guest park: about 6 sessions in 12 simulated minutes with 10 benches. Why: only tired guests sit (energy 70 or less), rides give +32 energy and energy falls 1 per 512 ticks, so a guest that keeps riding rarely tires; nausea never reaches the 128 threshold in this sim (max ~28 in the scripted park). In the 8-month headless run with benches on every third path tile, 17.6% of guests sit at least once (22.4% with a bench on every eligible tile), 103 to 121 sessions in 5 months of bench time.

Snapshots are logged in the page by wrapping `Worker` message events (`helpers/bench-seating.spec.ts`), so the counts come from the running game's own snapshots, not from the unit fixtures.
