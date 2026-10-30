# Stall items gap 10 proof

This report records the recovered shop and stall work in PR #175 after rebasing on PR #177.

## Catalog and availability

- The build menu has six distinct food and drink stall choices: the existing Food Stall (burger), Drink Stall, Chips Stall, Ice Cream Stall, Candyfloss Stall, and Pizza Stall. Popcorn Stall adds another food choice.
- Balloon Stall, Hat Stall, and Souvenir Stall add souvenir choices. The Information Kiosk sells both the Park Map and Umbrella. Toilets remain available as a service.
- Starter parks begin with item IDs 25–28 available (Chips, Ice Cream, Candyfloss, Balloon). The later shop research inventions unlock Pizza, Popcorn, Hat, and Souvenir Stall (IDs 29–32). Existing food, drink, kiosk, and toilet availability is preserved.
- Sandbox exposes the full catalog. The desktop and mobile screenshots show the readable names, prices, and distinct previews.
- Existing catalog IDs remain stable. Save format advances to v37; loading older parks preserves a kiosk's umbrella price and initializes its new map price from the catalog. Existing research state is retained.

## Behavior and art

Guests buy items from open, connected stalls; the transaction records sales and stock cost, and consumption updates hunger, thirst, toilet need, rubbish, and carried souvenirs. Ice cream availability depends on temperature. The kiosk reports map and umbrella prices, sales, worth, and profit separately.

The eight stall proof E2Es passed after rebuilding all generated atlas pages. They verify guest purchases in dry and rainy weather, kiosk and balloon stall controls, and shopfront screenshots at camera rotations 0–3 in both WebGL2 and Canvas2D. Test launch asserts the actual renderer backend. Original procedural stall art is in the repository; the screenshots show the loaded atlas rather than fallback placeholders.

Behavior choices were checked against the primary [OpenRCT2 guest behavior implementation](https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/entity/Guest.cpp), [OpenRCT2 shop item catalog](https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/ride/ShopItem.cpp), and the [RCT2 manual](https://rct2-docs.gitlab.io/). These references informed behavior and balancing only; no game code or art was copied.

## Verification

- `pnpm check`: lint, format check, and typecheck passed; 2,590 Vitest tests passed. The remaining year-end seed-1 test hit its existing 30-second timeout. The same test times out on current `main` under this runtime; the direct seed-1 balance command passes on both revisions. No scenario objective, seed, assertion, or timeout was changed.
- TypeScript and production bundle: `pnpm exec tsc --noEmit` and `pnpm exec vite build` passed against the generated atlases. The full `pnpm build` prebuild hook was also attempted; its second atlas pack was killed with exit 137 while the session browser was resident, after the same art preparation and atlas pack had completed successfully for the proof run.
- Stall gameplay proof on the rebased tree: `pnpm exec playwright test --config=playwright.e2e.config.ts e2e/stall-items-proof.spec.ts` — 8 passed. The run used the generated atlas and SwiftShader-enabled Chromium; the test config's temporary server override was reverted.
- Same-seed starter balance, seed 3, modest profile: current `main` won with 345 guests at rating 629; the feature won with 318 guests at rating 591 (target 100 guests / 450 rating). Both meet the unchanged objective.
- 5,000 guests, 100 staff, 498 measured entities including litter created during warmup, 400 measured ticks after 150 warmup ticks; three sequential samples per revision. Median main mean was 1.404 ms/tick and median feature mean was 1.413 ms/tick (+0.6%). Median p99 was 8.193 ms/tick on main and 6.626 ms/tick on the feature (19.1% lower). All feature samples remain within 10% of main on mean and improve p99.

## Screenshots

The PNGs in this directory cover the desktop and mobile Sandbox build menu, an opened Pizza Stall, stall transactions and guest purchases, and all four views in both renderers. `shopfronts-<renderer>-rot<n>.png` records the actual renderer in its name.

- Build menu: [Sandbox desktop](sandbox-menu-desktop.png), [Sandbox mobile](sandbox-menu-mobile.png), and [Sandbox mobile lower rows](sandbox-menu-mobile-lower.png).
- Construction: [Pizza Stall placed and open](pizza-stall-open.png).
- Stall controls: [Information Kiosk](stall-window-kiosk.png), [Balloon Stall](stall-window-balloon.png).
- Guest purchases: [dry, WebGL2](guests-carrying-dry-webgl2.png), [rain, WebGL2](guests-carrying-rain-webgl2.png), [dry, Canvas2D](guests-carrying-dry-canvas2d.png), [rain, Canvas2D](guests-carrying-rain-canvas2d.png).
- Camera rotations: [WebGL2](shopfronts-webgl2-rot0.png), [WebGL2 1](shopfronts-webgl2-rot1.png), [WebGL2 2](shopfronts-webgl2-rot2.png), [WebGL2 3](shopfronts-webgl2-rot3.png); [Canvas2D](shopfronts-canvas2d-rot0.png), [Canvas2D 1](shopfronts-canvas2d-rot1.png), [Canvas2D 2](shopfronts-canvas2d-rot2.png), [Canvas2D 3](shopfronts-canvas2d-rot3.png).

## Merges and deployment

- PR #177 was merged first as `e946b2a79a90477ad1444c2ace8088b831c12b3c`.
- PR #175 merge SHA and the GitHub Actions deployment run will be added after merge and live verification.
