# Public-repo cleanup proof

Branch `chore/public-repo-hygiene` (commit c1b413ac). Review captures it moved off `main` are in [`../from-main/`](../from-main/README.md).

- `clean-clone-canvas2d-starter-park.png`: production build from a fresh clone of the branch (`pnpm install --frozen-lockfile`, `pnpm build`, no API keys set), served by `vite preview` and opened in Chromium with Canvas2D forced. Starter Park draws atlas art: 59 sprite responses and no 4xx; the HUD reports 2,182 sprites drawn.
- Generated `public/sprites/` from that clone, where `tools/sprites/.build/` is absent, is byte-identical to the output of a checkout that still had `.build`: SHA-256 `50fe74ab…` over all 24,882 files, 68 atlas pages, 8,422 manifest sprites. After the build, `git status --porcelain` is empty and `public/sprites/` is ignored.
- `docs-review.html` / `docs.diff`: the prose and config changes, for review.
