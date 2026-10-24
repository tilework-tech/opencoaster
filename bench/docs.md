# Noridoc: Benchmarks

Path: @/bench

### Overview

- This folder measures simulation tick cost and isolated guest pathfinding throughput.
- The simulation benchmark runs the real `Simulation` with a seeded world and reports latency percentiles against a strict p99 budget.
- Its default scenario has 5,000 guests, 100 mixed staff, and 1,000 distributed litter items on a path lattice with full bins.

### How it fits into the larger codebase

- [bench.ts](bench.ts) configures the workload and times individual calls to `Simulation.step()`; [scenario.ts](scenario.ts) builds the seeded path-lattice park, distributes the 100-staff default as 60% handymen, 10% mechanics, 10% security, and 20% entertainers, places full bins, and seeds litter across walkable paths.
- The simulation benchmark excludes worker snapshot copying and browser rendering. The browser smoke run is configured at the project root and records renderer frame timings separately.
- [pathfinding.ts](pathfinding.ts) exercises the pathfinding API against a deterministic synthetic grid, isolating walker decision throughput from the full simulation.
- [balance.ts](balance.ts) (`pnpm balance`) is the gameplay-balance harness: [balance-park.ts](balance-park.ts) scripts a starter park (minimal, modest or ambitious profile) with player commands, and the runner steps one in-game year and prints guest count, rating curve, cash, ride usage (including reliability, breakdown count and downtime ticks), the guest thought histogram, the ledger and the objective result. `balance.test.ts` pins its determinism and basic health. Results are recorded in [docs/BALANCE.md](../docs/BALANCE.md).
- [stats.ts](stats.ts) supplies nearest-rank percentile and budget helpers used by the benchmark and its tests.

### Core Implementation

- The simulation benchmark accepts `--guests`, `--staff`, `--litter`, `--ticks`, and `--warmup`; defaults are 5,000 guests, 100 staff, 1,000 litter items, 400 measured ticks, and 40 warmup ticks. Warmup steps occur before the measured loop, and each measured step is timed independently.
- Tick samples are sorted to report mean, p50, p95, p99, and maximum latency. Percentiles use nearest-rank selection, with rank `ceil(p × sample count)` and a minimum rank of one.
- `--strict` exits unsuccessfully when p99 exceeds the 3 ms budget; ordinary benchmark runs still print whether that budget passed.

### Things to Know

- Use `pnpm bench -- --guests 5000 --ticks 200 --strict` to enforce the budget on the default mixed-staff and litter scenario. Percentiles are sensitive to the sample count, so compare runs with the same tick and warmup counts.
- The nearest-rank helper copies its input before sorting, so callers retain their original sample ordering. It rejects empty samples and percentiles that are non-finite or outside the inclusive zero-to-one range.
- The pathfinding microbenchmark is a separate workload; it should not be interpreted as a full-tick simulation result.

Created and maintained by Nori.
