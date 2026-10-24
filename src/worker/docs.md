# Noridoc: Worker

Path: @/src/worker

### Overview

- This module runs the authoritative simulation off the browser main thread and defines its message boundary.
- It publishes map data once and pooled, transferable render snapshots as simulation ticks advance.
- Main-thread UI and rendering consume snapshots and stats without reading worker-owned simulation objects.

### How it fits into the larger codebase

- [SimClient](sim-client.ts) starts [sim.worker.ts](sim.worker.ts), sends commands and scheduler controls, and receives map data, snapshots, and stats.
- [SimRunner](sim-runner.ts) owns the [Simulation](../sim/core/simulation.ts) and advances it through [FixedStepScheduler](scheduler.ts); `pump()` runs due ticks, updates timing statistics, and publishes a snapshot when a pooled buffer is available.
- [snapshot.ts](snapshot.ts) translates simulation entity columns into the render-facing data format consumed by [src/render](../render/docs.md) and the information panels in [src/ui](../ui/docs.md).
- The pool uses transferable `ArrayBuffer`s and recycle messages: the worker transfers a snapshot to the main thread, and the client returns the previously consumed buffers for reuse.

### Core Implementation

- [protocol.ts](protocol.ts) defines initialization, simulation command, speed, pause, recycle, map, snapshot, and stats messages.
- Each snapshot layer stores a count and a typed array with four `Int32` values per entity: fixed-point x, y, z, then packed state and tint/kind. The worker publishes rides at their entrances, track pieces from `world.track.pieces`, and a park summary with cash, loan, and ride count.
- Track positions are tile-centered and include height; the packed value carries direction and piece type for rendering. The renderers draw this layer alongside terrain and other entities.
- Static map dimensions, heights, surface classes, and slope masks travel in a separate map message. Periodic stats report tick, guest count, smoothed and peak simulation cost, and dropped ticks.

### Things to Know

- Snapshot buffers, including the track-piece layer, are transferred rather than copied; after transfer, the sender's typed-array backing buffers are detached until they are returned through a recycle message.
- Three snapshots are pooled per run. If no free snapshot is available after ticks advance, publication is skipped, allowing the simulation to keep moving while the main thread catches up.
- Ride rendering data is capped by the snapshot ride capacity. `rides.count` in the park summary reflects the simulation count, while the ride layer count reflects how many rides fit in the output buffer.
- The track layer has a fixed pooled capacity. Its snapshot count is capped by that buffer's capacity, and its backing buffer follows the same transfer and recycle lifecycle as the other entity layers.

Created and maintained by Nori.
