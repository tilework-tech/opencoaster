# AGENTS.md

OpenCoaster: browser-based, clean-room theme-park management game. Read CONTRIBUTING.md (clean-room rules are mandatory) and docs/ARCHITECTURE.md first.

## Commands (pnpm 10, Node >= 20)

| Command                        | Purpose                                                      |
| ------------------------------ | ------------------------------------------------------------ |
| `pnpm install`                 | install                                                      |
| `pnpm dev`                     | Vite dev server (COOP/COEP headers on)                       |
| `pnpm lint`                    | ESLint                                                       |
| `pnpm format` / `format:check` | Prettier                                                     |
| `pnpm typecheck`               | `tsc --noEmit` (strict)                                      |
| `pnpm test`                    | Vitest, single run                                           |
| `pnpm build`                   | typecheck + Vite production build                            |
| `pnpm bench`                   | sim benchmark (`-- --guests 5000 --strict`)                  |
| `pnpm balance`                 | balance harness; `-- --scenario all` for win rates           |
| `pnpm check`                   | everything CI runs                                           |
| `pnpm smoke` / `smoke:subpath` | Playwright smoke (dev / prod build at `/opencoaster/`)       |
| `pnpm e2e:quick`               | desktop e2e subset, one spec per major tool (<5 min)         |
| `pnpm e2e`                     | full Playwright e2e, desktop + Pixel 8 (~75 min, one worker) |
| `pnpm e2e:art-review`          | art inventory captures (excluded from `pnpm e2e`)            |

## UI PR checklist

`pnpm e2e:quick` must pass before marking any UI PR ready. Run the full `pnpm e2e` when a PR renames, moves or removes controls. Update specs in the same PR and select by role or label, not CSS or icon ids.

## Layout

`src/sim/{core,map,guests,rides,track,vehicles,economy,staff,weather,research,scenario,pathfinding}` deterministic simulation (runs in a worker); `src/worker` protocol/runner/client; `src/render` renderers; `src/ui` DOM UI; `src/save` serialisation; `bench/` benchmark; `docs/mechanics/` researched mechanics specs (with source URLs).

## Generated sprite assets

- `public/sprites/` is generated and Git-ignored. Commit authoritative art sources, prompts, and generators; do not commit generated sprite pages, manifests, PNGs, or per-sprite metadata.
- `predev` and `prebuild` run `tools/art/prepare.ts` and `tools/art/pack-cli.ts`. The smoke and e2e Playwright servers use `pnpm dev`; CI and GitHub Pages use `pnpm build`, so these paths prepare sprites automatically. `pnpm smoke:subpath` also builds before serving the generated output.
- Vite excludes `public/sprites/**` from its dev watcher because generation writes many files. The files remain available to the server and production build.
- See [tools/art/README.md](tools/art/README.md) for the art pipeline and regeneration details.

## Conventions

- TypeScript strict; ES modules; type-only imports use `import type`.
- Sim code: integers only in stored state, `Prng` for randomness, no clock, no allocation per tick, struct-of-arrays via `EntityStore`. New systems go in `SYSTEM_ORDER` (src/sim/core/simulation.ts).
- To add an entity field: edit the module's `*_SCHEMA`; hashing and save follow automatically (add a save version bump for released formats).
- Renderers read `Snapshot`/`MapData` only, never sim state.
- Comments describe the code, not its history. Prefer third-party libraries to hand-rolled ones (ask before adding a dependency).
- Never push to `main`; PRs only. Never commit original game assets or copied OpenRCT2 code.
- GitHub session tokens cannot push `.github/workflows/`; ask an admin-elevated session to change CI (`.github/workflows/ci.yml`).
