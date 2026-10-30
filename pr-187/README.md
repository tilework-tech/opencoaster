# PR #187 proof: stall storefronts

Browser evidence captured with Playwright (software WebGL2, and Canvas2D with WebGL disabled) against the dev build of `fix/storefront-orientation` at 50a7c41a (code; later commits are docs only), rebased on main 7794c2ad.

- `before-main-shared-tile-stall-not-open.png`: **before**, unmodified main 284cca7e. Food Stall 2 is drawn facing the path it shares with Food Stall 1, but it never opened ("Place entrance next to the ride."). Snapshot: state Closed, no access.
- `{webgl2,canvas2d}-ghost-{0..3}.png`: placement ghost for each facing. A green front tile and a T-shaped arrow out of the window edge; the status line names the screen direction and the footpath. Facing +x was reached after four T presses, facing +y (corner site) by the Rotate stall button.
- `{webgl2,canvas2d}-stall-sheet.png`: 4 stalls (facings +x, -x, -y, +y) × 4 camera rotations, zoomed after art loaded; each striped awning (the window) faces its path. Individual crops are `*-stall-<dir>-rotation-<r>.png`.
- `{webgl2,canvas2d}-built-rotation-{0..3}.png`: the whole site with 400 guests after every stall has served guests (asserted via `GuestsServed > 0`).
- `{webgl2,canvas2d}-ghost-refused.png`: a Drink Stall facing grass. The marker is red, with the status "No footpath in front of the service window…".
- `{webgl2,canvas2d}-ride-window-reason.png`: the built but unreachable stall is open and the ride window names the blocker.
- `{webgl2,canvas2d}-turn-built-stall.png`: **Turn stall** from the ride window. The new path side is green; the other sides are red with reasons. After the turn, guests were served (asserted).
- `{webgl2,canvas2d}-phone-rotate.png`: Pixel 8, Rotate stall tapped, then a tap to build; the stall faces +y and is open and serving.
- `scripts/stall-storefront.spec.ts`: the spec that produced them. Run `STOREFRONT_PROOF_DIR=<dir> [CANVAS2D=1] pnpm exec playwright test --config=playwright.e2e.config.ts e2e/stall-storefront.spec.ts`.

The same spec also checks save then import (facings and access kept) and runs as a regression without the proof directory.
