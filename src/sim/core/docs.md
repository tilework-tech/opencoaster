# sim/core

Responsibility: the deterministic simulation kernel. Owns `World` (all sim state), `Simulation` (command queue + ordered system execution), `Prng` (seeded sfc32), `EntityStore` (struct-of-arrays storage with dense swap-remove and stable ids), constants (tick rate, fixed-point scale, capacities) and `hashWorld` (state hash for determinism tests).

Interface: `new Simulation(opts)`, `enqueue(Command)`, `step()`. Commands include `economy` (`EconomyAction`) and `research` (`ResearchAction`), which player inputs use. Systems implement `System { name, update(world) }` and are registered in `SYSTEM_ORDER` (simulation.ts). Adding a field to a store means editing that module's `*_SCHEMA`; `hashWorld` and `save` pick it up automatically.

Rules: no `Math.random`, clock, floats in stored state, or iteration over `Map`/`Set` in hot paths (ESLint enforces the first two under src/sim).
