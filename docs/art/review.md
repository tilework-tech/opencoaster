# Art review

Generated contact sheets live in `docs/art/review/` while the audit runs locally. PNGs are ignored by Git because the full matrix is large. The interactive viewer is [index.html](review/index.html).

## Capture scope

`pnpm art:review` places every catalog scenery item, path addition, path type, ride, stall, and facility on a test map. It captures the default and maximum zoom in four rotations for Canvas2D and WebGL2. Flowerbeds also capture zoom 0.5 and 2, with flat and sloped ground beside grass and a path, plus a legacy comparison.

Severity: **high** means the art is broken or hard to identify during ordinary play; **medium** means a visible scale, alignment, or readability issue; **low** means a minor polish issue.

## Findings

<!-- Findings are added after inspecting all generated sheets. -->
