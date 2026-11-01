# GitHub Pages deploy

The game is served at https://opencoaster.noriagentic.com/ over HTTPS. `public/CNAME` names that domain, and GitHub Pages redirects both https://tilework-tech.github.io/opencoaster/ and plain HTTP to it.

## Workflow

- [.github/workflows/pages.yml](../../.github/workflows/pages.yml) is installed and deploys on every push to `main` and on manual `workflow_dispatch`. It runs `pnpm build`, uploads `dist/` with `actions/upload-pages-artifact`, and publishes it with `actions/deploy-pages`.
- After deploying, an "Ensure custom domain" step sets the Pages custom domain back to `opencoaster.noriagentic.com` if it has been cleared. The step is allowed to fail without failing the deploy.
- Pages Source in the repository settings is "GitHub Actions".
- [pages.yml](pages.yml) in this folder is a historical copy from before the workflow was installed and has drifted from it. Edit the installed workflow, not this copy.

## Base path

- Production builds use a relative Vite base (`./`) by default, so `dist/` works at the domain root and under a subpath such as `/opencoaster/`. Set `OC_BASE` (e.g. `OC_BASE=/opencoaster/ pnpm build`) to pin an absolute base instead.
- `pnpm smoke:subpath` builds `dist/`, serves it under `/opencoaster/` with no cross-origin isolation headers (`tools/serve-subpath.mjs`), and runs the smoke suite against it. GitHub Pages sends no COOP/COEP headers, so this matches production.

Dev and preview builds keep the root base and the COOP/COEP headers the Vite dev server sends.
