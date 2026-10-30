# Scenery expansion proof

PR: feat/scenery-expansion (19 new decorations, grouped thumbnail Scenery menu).

Reproduce (from the PR branch, `pnpm install`, Playwright chromium installed):

    SCENERY_PROOF_DIR=.local/scenery-proof pnpm e2e:art-review -g "scenery"
    node bench/render/scenery-frame-time.mjs http://127.0.0.1:4173/ webgl2   # needs `pnpm dev --port 4173`

Files:
- `{webgl2,canvas2d}-<group>.png` - every new item, in-game close view (zoom 3), camera rotation 0/1/2/3 left to right.
- `{webgl2,canvas2d}-facings-*.png` - directional items at placement facing 0-3 (camera rotation 0).
- `{webgl2,canvas2d}-ghosts-*.png` - placement ghost with price label at camera rotation 0 / 1.
- `{webgl2,canvas2d}-decorated-park-rotation-{0,1}.png` - small park built from the new catalogue.
- `menu-desktop-*.png`, `menu-phone-*.png` - Scenery menu per group, desktop and Pixel 8.
- `perf-frame-time.jsonl` - frame cost vs main (baseUrl :4174 = main, :4173 = branch; last two rows = branch with +428 decorations).
