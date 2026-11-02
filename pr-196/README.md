# PR #196 proof: phones frame the selected track piece

`before/`: `main` at 7c5857f7, and `after/script/`: this PR, both captured with `scripts/phone-selection.proof.ts`. The run is WebGL2 on an emulated Pixel 8 in portrait (412×839) and landscape (915×412). It taps the circuit's 7th piece, presses Edit from this piece (`*-selected.png`), then Next piece (`*-next.png`).

- **Before, portrait:** the ride and construction sheets cover the map and piece 7 is hidden.
- **Before, landscape:** the ride and construction windows both float over the piece, and Build/Demolish sit below the window's fold.
- **After:** the ride window closes, the construction window puts the selection and Build/Demolish rows first, and the camera frames piece 7 in the uncovered map. Next keeps piece 8 in view without moving the camera.

`after/<renderer>-<device>-<flow>/`: captures from `e2e/track-edit-selection.spec.ts` on this PR (all 10 tests passing). Each `*.png` is a crop around the selection outline, and each `*-full.png` is the whole screen.

- **Desktop `circuit-selected` and `rotated-selected`** match #194's desktop captures (`scripts/compare.mjs` mean RGB difference 0.06 to 0.28, which is the outline pulse).
- **Desktop `circuit-gap`** differs from #194 on purpose. The spec now pans the camera away, and Next piece brings the selection back into view.

Reproduce:
- Serve the app on port 4173 (`pnpm dev --port 4173`).
- From the repo root, run `PROOF_URL=http://127.0.0.1:4173 PROOF_OUT=out npx playwright test --config=<path>/scripts/playwright.proof.config.ts`. The script imports `e2e/support`, so copy `scripts/` to `.local/proof/` in a checkout first.
