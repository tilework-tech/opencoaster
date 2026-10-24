# worker

Responsibility: runs the sim off the main thread and defines the message protocol.

Interface: `protocol.ts` (ToWorker/FromWorker), `SimRunner` (worker-side driver, Node-testable), `FixedStepScheduler` (wall time -> whole ticks, catch-up cap), `snapshot.ts` (render snapshot layout, stride 4 Int32 per entity), `SimClient` (main-thread handle), `sim.worker.ts` (entry). See docs/ARCHITECTURE.md.
