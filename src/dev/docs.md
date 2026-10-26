# Noridoc: Dev fixtures

Path: @/src/dev

### Overview

- [depth-fixture.ts](depth-fixture.ts), loaded by [depth-fixture.html](../../depth-fixture.html) at the repository root, draws one hand-built 16×16 map and a single guest or staff member through either renderer. It exists for depth-sorting checks and is served only by `pnpm dev`; the production build does not include it.

### Core Implementation

- Query parameters: `renderer=webgl2|canvas2d`, `rot=0..3`, `scene` (`blank`, `path-flat`, `path-queue`, `path-raised`, `path-slope`, `path-slope-y`, `bench`, `lamp`, `bin`, `shelter`, `tree`, `stall`), `actor=guest|staff|none`, `gx`/`gy`/`gz` (tile units and levels, fractional), `dir`, `zoom`, `w`/`h`/`dpr`, and `focus=x,y,z` for a fixed camera.
- The page sets `window.__ready` once redraws stop changing the canvas (sprite categories load lazily). `window.__show(guest | null, focus)` redraws with the guest moved or removed and the camera re-centred; `window.__move(x, y, z)` moves the guest.
- Terrain is dirt so the generated ambient trees do not appear. Slope pieces use the same flags and base levels as `MapData.pathElements`.
