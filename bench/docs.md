# Noridoc: Benchmarks

Path: @/bench

### Overview

- This folder measures simulation tick cost, isolated guest pathfinding throughput, and main-thread audio snapshot-update cost.
- The simulation benchmark runs the real `Simulation` with a seeded world and reports latency percentiles against a strict p99 budget.
- Its default scenario has 5,000 guests, 100 mixed staff, and 1,000 distributed litter items on a path lattice with full bins.

### How it fits into the larger codebase

- [bench.ts](bench.ts) configures the workload and times individual calls to `Simulation.step()`; [scenario.ts](scenario.ts) builds the seeded path-lattice park, distributes the 100-staff default as 60% handymen, 10% mechanics, 10% security, and 20% entertainers, places full bins, and seeds litter across walkable paths.
- The simulation benchmark excludes worker snapshot copying and browser rendering. The browser smoke run is configured at the project root and records renderer frame timings separately.
- [pathfinding.ts](pathfinding.ts) exercises the pathfinding API against a deterministic synthetic grid, isolating walker decision throughput from the full simulation.
- [audio.ts](audio.ts) feeds a warmed synthetic snapshot with a large guest count and many rides through [AudioEngine](../src/audio/audio.ts), using a recording Web Audio context so the benchmark measures JavaScript update and scheduling overhead without browser audio rendering.
- [balance.ts](balance.ts) (`pnpm balance`) is the gameplay-balance harness: [balance-park.ts](balance-park.ts) scripts a starter park (rides take their real footprints: each side of the spine allocates rows for queue, exit and body, and late additions that no longer fit are skipped) (minimal, modest or ambitious profile) with player commands, and the runner steps one in-game year (flags `--admission DOLLARS` and `--repay-loan-month N` and `--stalls-at-value` stand in for a player who sets the gate price, prices stalls at their value and pays off the loan) and prints guest count, rating curve, cash, ride usage (including reliability, breakdown count and downtime ticks), the guest thought histogram, the ledger and the objective result. Stalls and facilities use adjacent public paths for direct access; ordinary rides use entrances, exits, and queues. `balance.test.ts` pins determinism and basic health. Results are recorded in [docs/BALANCE.md](../docs/BALANCE.md).
- [finance-proof-save.ts](finance-proof-save.ts) writes a scripted starter park as a save file after a few months, for filming the Finances window ([e2e/finances.spec.ts](../e2e/finances.spec.ts)).
- [scenario-balance.ts](scenario-balance.ts) (`pnpm balance --scenario <id|all> [--seeds 12] [--jobs N] [--trace]`) plays each shipped scenario with its scripted strategy over seeds 1..N, one child process per seed group, and prints the win count and per-seed outcome. [strategy/](strategy) holds the scripts: `builder.ts` places rides, stalls, and coasters on the gate-relative park grid; ordinary rides and coasters use entrance/exit and queue paths, while stalls and facilities use an adjacent public path for direct access. The builder adds bins along paths and a walkway around each coaster; `growth.ts` is the build-order strategy (cash-gated, optional per-seed imperfection); `coasters.ts` holds the searched circuits; `strategies.ts` assigns one per scenario. The balance harness unlocks the ride catalog before play to isolate park and economy tuning from research pacing; normal scenarios still enforce their own unlocks at the simulation command boundary. `scenario-balance.test.ts` checks every scenario has a strategy that builds an open park. A have-fun scenario counts as won when, after four years, the park is solvent, rated 600 or more and holds 200 guests.
- [stats.ts](stats.ts) supplies nearest-rank percentile and budget helpers used by the benchmark and its tests.

### Core Implementation

- The simulation benchmark accepts `--guests`, `--staff`, `--litter`, `--ticks`, and `--warmup`; defaults are 5,000 guests, 100 staff, 1,000 litter items, 400 measured ticks, and 150 warmup ticks. Warmup steps occur before the measured loop so V8 finishes compiling the hot paths; with 40 warmup ticks, p99 includes compile-time spikes from the first measured ticks (about 2.3 ms against about 1.0 ms at 150 on the CI configuration). Each measured step is timed independently.
- `pnpm bench:audio` reports p50, p95, and p99 update latency for 2,000 frames and 128 rides by default. `AUDIO_BENCH_TICKS` and `AUDIO_BENCH_RIDES` adjust that workload, and `pnpm bench:audio -- --strict` fails when p99 reaches or exceeds 0.5 ms.
- Tick samples are sorted to report mean, p50, p95, p99, and maximum latency. Percentiles use nearest-rank selection, with rank `ceil(p × sample count)` and a minimum rank of one.
- `--strict` exits unsuccessfully when p99 exceeds the 3 ms budget; ordinary benchmark runs still print whether that budget passed.

### Things to Know

- Use `pnpm bench -- --guests 5000 --ticks 200 --strict` to enforce the budget on the default mixed-staff and litter scenario. Percentiles are sensitive to the sample count, so compare runs with the same tick and warmup counts.
- The nearest-rank helper copies its input before sorting, so callers retain their original sample ordering. It rejects empty samples and percentiles that are non-finite or outside the inclusive zero-to-one range.
- The pathfinding microbenchmark is a separate workload; it should not be interpreted as a full-tick simulation result.
- The audio benchmark uses a fake context and measures snapshot traversal, projection, voice bookkeeping, and audio-node scheduling calls; it does not measure audio-thread rendering, browser autoplay behavior, or device output latency.

Created and maintained by Nori.
