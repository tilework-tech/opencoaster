# Noridoc: Benchmarks

Path: @/bench

### Overview

- This folder measures simulation tick cost and isolated guest pathfinding throughput.
- The simulation benchmark runs the real `Simulation` with a seeded world and reports latency percentiles against a strict p99 budget.

### How it fits into the larger codebase

- [bench.ts](bench.ts) creates a simulation using core constants and systems, spawns the requested guest load plus staff, then times individual calls to `Simulation.step()`.
- The simulation benchmark excludes worker snapshot copying and browser rendering. The browser smoke run is configured at the project root and records renderer frame timings separately.
- [pathfinding.ts](pathfinding.ts) exercises the pathfinding API against a deterministic synthetic grid, isolating walker decision throughput from the full simulation.
- [stats.ts](stats.ts) supplies nearest-rank percentile and budget helpers used by the benchmark and its tests.

### Core Implementation

- The simulation benchmark accepts `--guests`, `--ticks`, and `--warmup`; its defaults provide a repeatable seeded scenario. Warmup steps occur before the measured loop, and each measured step is timed independently.
- Tick samples are sorted to report mean, p50, p95, p99, and maximum latency. Percentiles use nearest-rank selection, with rank `ceil(p × sample count)` and a minimum rank of one.
- `--strict` exits unsuccessfully when p99 exceeds the configured budget; ordinary benchmark runs still print whether that budget passed.

### Things to Know

- Use `pnpm bench -- --guests 5000 --ticks 200` to measure the full simulation at the 5,000-guest load. Add `--strict` to make the p99 budget enforceable in automation.
- The nearest-rank helper copies its input before sorting, so callers retain their original sample ordering. It rejects empty samples and percentiles that are non-finite or outside the inclusive zero-to-one range.
- The pathfinding microbenchmark is a separate workload; it should not be interpreted as a full-tick simulation result.

Created and maintained by Nori.
