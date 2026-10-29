# PR #181 benchmark and entrance review

> **Superseded (2026-10-29).** The "kept as `it.fails`" and "gate movement boundary" conclusions below were true for PR #181 head `5f598233` and are replaced by the resolution section at the end of this file. Measurements below are retained as history. The rating column here was read at a different point than the later paired harness (seed 2026 PR: 446 here vs 494 in the resolution table; both Lost), so compare outcomes, not those two ratings, across the two tables.


This note adds paired simulation evidence to the existing visual proof at commit `e7d7b9c0`. The screenshots and save are unchanged.

## Paired year-end run

Both trees used Node `v22.20.0`, pnpm `10.34.8`, the locked dependencies, and the same `createBalancePark` script with the starter scenario's configured default seed, `2026`. The run called `runSchedule()` and `sim.step()` for `FULL_YEAR = 131072` ticks and recorded state after tick `131071`, when the objective is evaluated. The objective needs at least 100 guests and rating 450.

| Tree | Revision | Guests | Rating | Objective | Litter | Open attractions | Unhappy | Lost | Downtime | Excitement | Intensity | Casualties | Ride value |
| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Main | `bd72461462d8bf9e24119fd80c938dac96631105` | 317 | 687 | Won | 20 | 5 | 4% | 0 | 0% | 2448 | 1780 | 0 | 307980 |
| PR | `67107df5b8371416e110a8204151f417d0af7749` | 344 | 446 | Lost | 33 | 4 | 15% | 0 | 20% | 2010 | 1440 | 0 | 341200 |

Both runs exceed the guest target. The PR misses the rating target by four points. Its cached rating is 446 at the rating refresh near year end; the scenario check then uses that score at tick 131071.

The seed-2026 difference is not a one-tick rating swing. Near the final check, main has 4% unhappy guests, no downtime and five open attractions; the PR run has 15% unhappy guests, 20% downtime and four open attractions. Main's litter rating input is 20 and the PR's is 33, all on tiles that the classifier considers interior at that checkpoint.

## Bounded seed comparison

The same paired harness was run only for fixed seeds 1–3 to check whether seed 2026 was an isolated outcome. All three seeds won on both trees, with materially different ratings and litter counts:

| Seed | Main guests / litter / rating | PR guests / litter / rating | Outcome |
| ---: | --- | --- | --- |
| 1 | 348 / 26 / 633 | 348 / 41 / 597 | Won on both |
| 2 | 352 / 19 / 682 | 347 / 40 / 577 | Won on both |
| 3 | 351 / 57 / 474 | 359 / 17 / 690 | Won on both |

These runs show seed-dependent variation; they do not justify substituting a favorable seed for the configured default.

## RNG divergence

For seed 2026, the RNG state is still identical after the guest system at tick `16623`. The first observed divergence is after the `staff` system on that tick:

| Point | Main RNG state | PR RNG state | Gate litter before staff |
| --- | --- | --- | ---: |
| After guests, tick 16623 | `[1894355290,3030073547,3746287501,917435654]` | `[1894355290,3030073547,3746287501,917435654]` | 1 / 0 |
| After staff, tick 16623 | `[3032550763,3651816437,1307553956,917435655]` | `[1855477673,881631789,3541610715,917435666]` | 1 / 0 |

The base run still has one piece of litter on the gate when staff run; PR #181 prevents that exterior litter. Staff therefore follow different state-dependent work paths and consume different numbers of random draws. This is downstream simulation RNG drift from the intended world-state change, not evidence of a missing draw in the litter or vandalism guard. Later simulation state diverges, including interior litter and ride downtime. No broad game-balance or RNG rewrite was made in this PR.

`bench/balance.test.ts` now keeps the default-seed `Won` expectation as a named Vitest `it.fails` case. It executes the original fixture and exposes the known failure in test output; it does not replace the seed or lower the objective. Remove the expected-failure marker only when the default fixture is made to win again for a justified reason.

## Gate movement boundary case

The straight approach classifier covers generated layouts. It does not follow paths after an off-axis gate move. Reproduction in the sandbox:

1. Start with gate `(63,95)` and spawn `(63,127)`.
2. Add connected path tiles `(63,94)` and `(64,94)`.
3. Move the gate to `(64,94)` with `setParkEntrance`; it succeeds and leaves the spawn unchanged.
4. `(63,94)` is a walkable tile on the bent spawn-to-gate route, but `isGateApproach` returns `false` and `isParkInterior` returns `true`.

`park-interior.test.ts` retains this concrete case as a named expected failure. Fixing it needs an explicit policy for classifying a route through an arbitrary connected path network, or a constraint on gate relocation; this PR does not pick one. Straight generated layouts and the existing gate/load transition regressions continue to pass.

## Reproduction

The paired results came from archived main and PR trees at the revisions above, using the same lockfile and a small harness equivalent to the year-end test:

```ts
const park = createBalancePark({ seed });
for (let tick = 0; tick < TICKS_PER_MONTH * 8; tick++) {
  park.runSchedule();
  park.sim.step();
}
const world = park.sim.world;
```

Use `seed = undefined` or `seed = 2026` for the configured starter seed, then repeat with fixed seeds 1, 2 and 3. Compare state after the final step. The exact paired snapshots and per-system RNG trace were captured from these runs; no seed sweep was performed.

## Resolution (PR #181 head `14a63940e9ccf496dc507a527c8119801fcf6fbe`)

### Bent gate approach
`isGateApproach` now uses the shortest connected footpath route (breadth-first over the path graph) from the gate to each spawn point, falling back to the straight axis-aligned span when no route joins them. The route mask is cached per world and rebuilt only when `map.pathVersion`, the gate or the spawns change. The `it.fails` case is now an ordinary test with controls (interior path beside the bend still litters/vandalises, save/load, two spawns, cache identity, cut route, scenery untouched). Browser proof: [bent-gate/](bent-gate/).

### Benchmark
Both trees show the same mechanism at seed 2026: with six handymen and one mechanic, litter at 300-plus guests swings between roughly 12 and 69 pieces between months, and the park rating (litter is an input) swings with it between about 320 and 700. The objective only samples the rating at the year-end tick, so main won by landing on a lull and the PR run landed on a spike. Preventing gate litter changes which tick that happens on; it is not a missing random draw.

I measured the levers a manager has (raw output: [fixture-evidence/](fixture-evidence/)), sampling rating and litter every 1,024 ticks from month 3 on for seeds 2026, 1, 2, 3 on both trees:

| Variant added with the coaster | Effect on mean litter (main / PR, 4 seeds) |
| --- | --- |
| none (6 handymen) | 26, 28, 36, 33 / 39, 30, 32, 21 |
| +2 handymen (8) | 25, 17, 19, 23 / 16, 19, 20, 18 |
| +1 mechanic | 28, 35, 33, 29 / 22, 40, 27, 35 (no consistent change) |
| +2 handymen +1 mechanic | 20, 21, 23, 28 / 22, 16, 31, 18 |

Handymen are the lever that consistently lowers litter on both trees; a mechanic does not. `bench/balance-park.ts` therefore hires four handymen with the coaster instead of two (eight total, about $100 a month more wages). The scenario target, seed and objective are unchanged and the change applies identically to base and PR.

Year-end paired results (`fixture-evidence/paired-year-end.txt`, harness `fixture-evidence/pairs.ts`; Main = `bd724614`, PR = this head). The PR tree with the old fixture was also run on `5f598233` and gave identical numbers, so the route semantics do not change straight layouts.

| Seed | Main, 6 handymen | Main, 8 | PR, 6 | PR, 8 |
| --- | --- | --- | --- | --- |
| 2026 (default) | Won, 317 guests, rating 675, litter 20 | Won, 342 / 609 / 37 | Lost, 345 / 494 / 33, 4 of 5 open | Won, 348 / 641 / 29 |
| 1 | Won, 348 / 653 / 24 | Won, 351 / 698 / 15 | Won, 347 / 593 / 41 | Won, 349 / 577 / 45 |
| 2 | Won, 352 / 682 / 19 | Won, 350 / 637 / 30 | Won, 347 / 595 / 40 | Won, 356 / 666 / 23 |
| 3 | Won, 351 / 530 / 57 | Won, 367 / 683 / 19 | Won, 359 / 571 / 16, 4 of 5 open | Won, 372 / 655 / 26 |

Seeds 1 to 3 were chosen before the change and were not swept. `bench/balance.test.ts` now runs seed 2026 and seeds 1, 2, 3 as ordinary tests with no expected-failure marker.

### Limits
Seeds are four samples, not a win-rate estimate; `pnpm balance --scenario all` was not run. Where two footpath routes are equally short the search picks one deterministically, so parallel adjacent paths can put the "outside" side on either one. A guest standing on a shared junction tile such as the bend counts as outside until it leaves the route.
