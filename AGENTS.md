# AGENTS.md

OpenCoaster: browser-based, clean-room theme-park management game. Read CONTRIBUTING.md (clean-room rules are mandatory) and docs/ARCHITECTURE.md first.

## Commands (pnpm 10, Node >= 20)

| Command                        | Purpose                                     |
| ------------------------------ | ------------------------------------------- |
| `pnpm install`                 | install                                     |
| `pnpm dev`                     | Vite dev server (COOP/COEP headers on)      |
| `pnpm lint`                    | ESLint                                      |
| `pnpm format` / `format:check` | Prettier                                    |
| `pnpm typecheck`               | `tsc --noEmit` (strict)                     |
| `pnpm test`                    | Vitest, single run                          |
| `pnpm build`                   | typecheck + Vite production build           |
| `pnpm bench`                   | sim benchmark (`-- --guests 5000 --strict`) |
| `pnpm balance`                 | one-year balance harness (docs/BALANCE.md)  |
| `pnpm check`                   | everything CI runs                          |
| `pnpm smoke` / `smoke:subpath` | Playwright smoke (dev / prod build at `/opencoaster/`) |

## Layout

`src/sim/{core,map,guests,rides,track,vehicles,economy,staff,weather,research,scenario,pathfinding}` deterministic simulation (runs in a worker); `src/worker` protocol/runner/client; `src/render` renderers; `src/ui` DOM UI; `src/save` serialisation; `bench/` benchmark; `docs/mechanics/` researched mechanics specs (with source URLs).

## Conventions

- TypeScript strict; ES modules; type-only imports use `import type`.
- Sim code: integers only in stored state, `Prng` for randomness, no clock, no allocation per tick, struct-of-arrays via `EntityStore`. New systems go in `SYSTEM_ORDER` (src/sim/core/simulation.ts).
- To add an entity field: edit the module's `*_SCHEMA`; hashing and save follow automatically (add a save version bump for released formats).
- Renderers read `Snapshot`/`MapData` only, never sim state.
- Comments describe the code, not its history. Prefer third-party libraries to hand-rolled ones (ask before adding a dependency).
- Never push to `main`; PRs only. Never commit original game assets or copied OpenRCT2 code.
- GitHub session tokens cannot push `.github/workflows/`; ask an admin-elevated session to change CI (`.github/workflows/ci.yml`).
