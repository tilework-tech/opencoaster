# OpenCoaster

An open-source, browser-based, clean-room theme-park management game inspired by the gameplay of 1999–2004 era roller-coaster tycoon games.

Status: playable end-to-end prototype (private until a maintainer approves going public). Procedural placeholder art only. Not affiliated with or endorsed by the publishers of any commercial game; contains none of their assets or code.

## Quick start

```sh
pnpm install
pnpm dev      # http://localhost:5173
pnpm check    # lint, format, typecheck, test, build
pnpm bench    # sim ms/tick with 5000 guests
pnpm e2e      # headless Chromium playtest; screenshots go to .local/playwright-results/
```

Docs: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [CONTRIBUTING.md](CONTRIBUTING.md) (clean-room rules), [AGENTS.md](AGENTS.md). Mechanics research lives in `docs/mechanics/`.

License: MIT.
