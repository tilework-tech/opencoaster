# Contributing

## Clean-room rules (mandatory)

OpenCoaster re-implements the _gameplay ideas_ of 1999–2004 era roller-coaster tycoon games without using any of their protected material.

- **Do not** use, download, extract or commit any original game assets: sprites, sounds, music, data files, scenario/track files.
- **Do not** use decompiled or disassembled code or data tables derived from it.
- **Do not** copy source code from OpenRCT2 (GPLv3) or any other incompatible-licence project into this repo. Reading public descriptions of behaviour (wikis, forums, OpenRCT2 documentation and issue discussions, videos, strategy guides) is fine; describe the mechanics in your own words and write original code.
- **Do not** use the "RollerCoaster Tycoon" name or logo in the product, UI, package names or marketing. Docs may mention it only descriptively (e.g. "inspired by").
- **Cite sources.** Every mechanics claim in `docs/mechanics/` links the public source URL(s) it came from.
- Art and audio must be procedurally generated or original and licensed compatibly with MIT.
- Numbers (rating formulas, costs, speeds) should be tuned for this game; if you derive one from a described public behaviour, cite it and say so.

If unsure whether something is allowed, ask in the PR before merging.

## Where files go

| Kind                 | Examples                                                                                        | Rule                                                                                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source art           | `tools/art/source/` sheets, `tools/art/prompts/`, `tools/sprites/` models and generators        | Commit. Never original game assets.                                                                                                                                                                |
| Generated output     | `public/sprites/`, `dist/`, `tools/sprites/.build/`, `.local/`                                  | Ignored; `pnpm dev` and `pnpm build` regenerate it. Never commit.                                                                                                                                  |
| Scenario previews    | `public/scenario-previews/`                                                                     | Commit. `pnpm dev` and `pnpm build` rewrite them only when scenario data changes; commit the result with that change.                                                                              |
| Test fixtures        | root `*-fixture.html` pages loaded by e2e/smoke on the dev server, `e2e/support/` save builders | Commit. Keep fixture URLs stable.                                                                                                                                                                  |
| Documentation images | `docs/screenshots/`, `docs/playtest/assets/`, `docs/art/` contact sheets                        | Commit. Refresh deliberately with the generating command (`UPDATE_SCREENSHOTS=1`, a spec's documented output variable, `pnpm sprites:*`, `art:coverage`); do not add one-off review captures here. |
| Review artifacts     | PR before/after proof captures                                                                  | Attach to the PR or push to the `nori/pr-proofs` branch, never `main`. Specs write to Playwright output under `.local/`.                                                                           |

## Workflow

- Never push to `main`; branch and open a PR. CI must pass: lint, format, typecheck, test, build.
- Use TDD: write the failing test first. Tests assert behaviour (inputs/outputs), not internals.
- Keep `src/sim` deterministic (see docs/ARCHITECTURE.md).
- Each module keeps its `docs.md` current when its responsibility or interface changes.
- See AGENTS.md for commands and conventions.
