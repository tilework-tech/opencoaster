# Integration of #182, #183, #181, #184 (2026-10-29)

Merged in order, each rebased on the then-current main with CI green on the exact merged head (squash, `--match-head-commit`, no admin/bypass):

| PR | Merge SHA | Notes |
|---|---|---|
| #182 HTTP save | a0f1bfa2 | `e2e/save-persistence.spec.ts` (not in CI) had two latent test bugs, fixed on the PR branch: `elType.flatMap` on a typed array, and a nonexistent `world.saveVersion`. It now asserts the saved header version equals `SAVE_VERSION`. Run manually: passes. |
| #183 night/rain | 930cf8d7 | rebased, no conflicts |
| #181 exterior cleanliness | b9d95ea5 | rebased, no conflicts; 2279 unit tests pass locally |
| #184 benches (save v35) | 1b240da7 | conflicts in `src/save/save.ts` (kept both `purgeExteriorMess` and `rebuildSeatOwners`) and `docs/mechanics/world.md`. Real interaction bug: #181 limits vandalism to the park interior, and the fixture `guestAt` moves the gate onto the guest's tile, so `benches.test.ts` "keeps vandals from breaking a bench someone is sitting on" stopped breaking the control bench. Fixed in the test by placing the gate off the bench. |

Later on main: 284cca7e (#185 Observation Tower, save v36) merged after this integration by the tower run; v35 bench migration preserved. CI and Pages deploy succeeded for 1b240da7 and for 284cca7e.

## Live checks (http://opencoaster.noriagentic.com/, real Chrome)
- Transport at check time: HTTP serves 200. HTTPS fails: the served certificate is `*.github.io` (no custom domain), so browsers reject it. Not fixed here.
- HTTP, insecure context (`isSecureContext=false`, `crypto.randomUUID` undefined): Sandbox -> Save to new slot -> "Game saved." -> reload -> Load game -> slot present -> loaded; park (gate, road, trees) intact (`live-http/http-save.png`, `http-reload.png`). Secure-context save/reload is covered by the e2e (passes locally on main). No browser storage was cleared; test slots were added.
- v34 import on live 1b240da7: `contaminated-sandbox-seed1.ocsave` (v34) imported, loaded, saved to a new slot: header version 35, gate (63,95) and spawn (63,127) unchanged. On live 284cca7e the genuine v34 tree save (`v34-sandbox-trees.ocsave`, made at bd724614) re-saved as version 36.
- Header/state roundtrip on the main tree (`v34-saves/*roundtrip.json`): the v34 tree park has 5184 trees, gate and edge spawn before and after v35 re-serialize and reload. The contaminated fixture has 0 trees (it cannot show tree preservation).

## Exterior vs interior (`v34-saves/v34-on-main-stats.json`, harness `harness/capture.spec.ts`, main tree, dev build)
Contaminated v34 save + 150 extra guests at 8x: litter outside the gate 0 on load and at every sample (final 0); interior litter 3 on load, 7 at the end. The prior #181 proof for main without the fix reported 70 outside at the same point (`exterior-litter-graffiti/before-stats.json`).

## Benches, UI-placed (`bench/`, harness `harness/bench-seating.spec.ts`, Canvas2D, main tree)
Ten benches placed through Scenery > Benches with real clicks in an imported scripted park; run at 4x. `session-log.json` shows 3 guests walked to a seat, sat (~30 ticks after the walk started) and stood up after about 1,050 ticks. The spec itself reports FAILED: its last step wants a guest seated at a given instant and found none; I did not weaken it. Natural use is rare (see pr-184/README.md). Pose renders in all four rotations in both renderers: `pose-canvas2d/`, `pose-webgl2/` (controlled fixture). WebGL2 natural-use run was not repeated.

## Night and rain (`night-rain/`, harness pr-proofs `playability-lighting-weather/capture-lighting.mjs`)
clear/rainy/storm night in Canvas2D and WebGL2, one renderer per process, validity gate passes (`"valid": true` in both reports); lamps, track and paths readable. Software rendering only; no GPU claims.

## Limits
- Interaction of queue-join with sitting guests relies on #184's own unit tests, which pass on the combined branch.
- Interior mess retained is observed in the stats above, not separately screenshotted.
