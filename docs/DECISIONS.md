# Decisions

Resolutions of the cross-spec conflicts listed in `docs/mechanics/README.md`. Constants marked *tunable* live in code as named constants and are calibrated in playtesting.

| Topic | Decision |
|---|---|
| Tick rate | 40 ticks/s (`TICK_RATE`). |
| World model | Tile element stacks per tile (engine spec). Track uses the same tile grid; sub-tile geometry belongs to track pieces, not the map. |
| Calendar | 16,384 ticks per month, 8 months per year (March-October). Tunable. |
| Wages | Accrue weekly; reported monthly in the finance report. |
| Excitement penalty | ×0.75 per intensity threshold exceeded. Tunable. |
| Park rating | Integer, clamped 0-999. Formula per economy spec; calibrate later. |
| Food/drink seeking | A hungry/thirsty guest heads to a known stall if it has seen one; otherwise wanders and buys on encounter. |
| Capacities | 8,192 guest slots; ride and entity ids are 32-bit. Perf target stays 5,000 guests under 8 ms/tick. |

## Parallel work conventions

- Each workstream owns its module directory under `src/sim/<module>` (or `src/render`, `src/ui`). Edits to `src/sim/core` (World, Command union, constants, `SYSTEM_ORDER`) must be small and additive; rebase on `main` before opening a PR.
- Every PR keeps `pnpm lint`, `format:check`, `typecheck`, `test`, `build` and `bench --guests 5000` green, and adds determinism tests (same seed, same `hashWorld`).
- Sessions cannot push `.github/workflows/`; ask the coordinator for CI changes.
