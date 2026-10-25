# GitHub Pages deploy

The game is served from a project-site subpath: https://tilework-tech.github.io/opencoaster/

## What is ready

- `docs/deploy/pages.yml` is a ready-to-install workflow. It runs `pnpm build` and deploys `dist/` with `actions/upload-pages-artifact@v3` and `actions/deploy-pages@v4` on every push to `main`.
- Production builds use a relative Vite base (`./`) by default, so `dist/` works at the site root or under `/opencoaster/`. Set `OC_BASE` (e.g. `OC_BASE=/opencoaster/ pnpm build`) to pin an absolute base instead.
- `pnpm smoke:subpath` builds `dist/`, serves it under `/opencoaster/` with no cross-origin isolation headers (`tools/serve-subpath.mjs`), and runs the smoke suite against it. GitHub Pages sends no COOP/COEP headers, so this is the production configuration.

## Installing the workflow

The GitHub session token cannot push `.github/workflows/` files, so the workflow lives here until an admin installs it:

1. Copy `docs/deploy/pages.yml` to `.github/workflows/pages.yml` and merge it.
2. In the repository settings, open Pages and set Source to "GitHub Actions".

Dev and preview builds keep the root base and the COOP/COEP headers the Vite dev server sends.
