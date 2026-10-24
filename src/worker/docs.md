# Noridoc: Worker

Path: @/src/worker

### Overview

- Runs the authoritative simulation off the browser main thread and defines its message boundary.
- Sends map geometry as needed and pooled, transferable render snapshots as simulation ticks advance.
- Lets the main-thread UI and renderer consume snapshots and statistics without reading worker-owned simulation objects.

### How it fits into the larger codebase

- [SimClient](sim-client.ts) starts [sim.worker.ts](sim.worker.ts), sends commands and scheduler controls, and receives map data, snapshots, and statistics.
- [SimRunner](sim-runner.ts) owns the [Simulation](../sim/core/simulation.ts) and advances it through [FixedStepScheduler](scheduler.ts). Its pump applies due ticks, updates timing statistics, and publishes a snapshot when a pooled buffer is available.
- [snapshot.ts](snapshot.ts) translates simulation entity columns into the render-facing format consumed by [src/render](../render/docs.md) and information panels in [src/ui](../ui/docs.md). It also publishes a per-tile buildability view for main-thread placement feedback.
- Snapshot buffers travel as transferable `ArrayBuffer`s. The client returns consumed buffers to the worker for reuse, keeping the simulation thread as the sole owner of live world state.

### Core Implementation

- [protocol.ts](protocol.ts) defines initialization, simulation command, speed, pause, recycle, save, load, map, snapshot, stats, and reply messages. `init` may carry a scenario definition, which the worker applies with `prepareScenario` before the first tick. `save` replies with the game's bytes (`saved`). `load` replaces the running game with a save (`loaded`) or fails with `error`.
- [SimClient](sim-client.ts) exposes `startGame`, `save()` and `load(bytes)` as promises. Replies to a save or load are matched to the oldest request of that kind. Snapshots that arrive between a start or load request and its confirmation belong to the previous game, so the client recycles and drops them.
- A snapshot layer has a count and four `Int32` values per entity. For guests, staff, vehicles, and litter, the values are fixed-point x, y, z, then packed state and tint or kind. Ride and track layers use their fourth value for renderer metadata.
- Ride entries are positioned at their entrances and carry the stable ride ID in the fourth value. Track entries carry tile-centered position and height; their fourth value packs ride ID in the high 16 bits, direction in the next 8 bits, and piece type in the low 8 bits.
- The snapshot also includes a park summary with cash, loan, and ride count, and a scenario block with the outcome status, the objective (or null in sandbox games), the live figure the objective compares with its target, and the park rating. Static map dimensions, heights, surface classes, and slope masks travel in a separate map message. Periodic statistics report tick, guest count, smoothed and peak simulation cost, and dropped ticks.
- `buildable` is a `Uint8Array` indexed by map tile. Each snapshot fills it from the map's `canBuild` result, representing owned land or construction rights for that tile.
- `rideInfo` carries `RIDE_INFO_STRIDE` ints per ride (same order as the ride layer), indexed by the `RideInfo` enum: id, type, state, phase, ratings, queue length, `RideFlag` bits (entrance/exit placed, queue connected, tested, circuit closed), guests served, price, track piece count, and the construction cursor. The cursor's tile and height are plain fields; direction, slope, bank and has-track are packed with `encodeCursor` / `decodeCursor`.
- `feedback` copies `world.feedback` (`seq`, `domain`, `code`, `subject`) so the UI can show the outcome of its latest command.

### Things to Know

- Snapshot buffers, including the track-piece layer and per-tile `buildable` array, are transferred rather than copied. After transfer, the sender's typed-array backing buffers are detached until the client returns them in a recycle message.
- Three snapshots are pooled. The pool is sized for the largest map seen so far and grows only when a larger map arrives; recycled buffers smaller than the current pool are dropped. If none is free after simulation ticks advance, publication is skipped so the simulation can continue while the main thread catches up.
- A new game or a load replaces the running `Simulation` in the same worker. The pool and the scheduler's speed and pause state carry over, so the player's settings survive a new game.
- Ride rendering entries expose stable IDs rather than ride state or type. The UI uses these IDs to associate track pieces with a ride; ride type and operating state remain in the simulation state.
- `rideInfo` is transferred and recycled like the other buffers; `feedback` is a plain object that travels with the snapshot message.
- Ride and track layer counts are capped by their output-buffer capacities, while the park summary's ride count reflects the full simulation count. The track layer and `buildable` array follow the same pooled transfer and recycle lifecycle as the other snapshot buffers.

Created and maintained by Nori.
