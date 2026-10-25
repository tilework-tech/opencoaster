# Noridoc: Ride Setup

Path: @/src/app/ride-setup

### Overview

- Coordinates ride creation and the follow-up steps required to make a ride usable.
- Owns ride placement state, placement feedback and client-side visual previews.

### How it fits into the larger codebase

- [bootstrap](../bootstrap/docs.md) supplies the worker client, UI, camera, coaster panel and preview elements.
- Ride selections originate in [src/ui](../../ui/docs.md); tile actions arrive from [app tools](../tools/docs.md).
- Commands are sent through [SimClient](../../worker/sim-client.ts), while the latest snapshots determine when creation or placement feedback has arrived.

### Core Implementation

- `createRideSetup` handles ride-type selection, ride/entrance/exit placement requests, and tracks pending work until snapshot feedback advances the flow.
- Ride ghosts and valid placement targets are projected for display; worker-side command validation remains authoritative.
- Flat rides and track rides place entrances and exits around the complete authored ride footprint or coaster station footprint. Candidate geometry is derived from the snapshot, while the worker validates each placement command.
- Boarding candidates remain keyboard accessible when invalid. Their accessible labels and status feedback identify the blocking condition; worker feedback is retained instead of being replaced by the next generic prompt.
- Stalls and facilities use a public path tile beside their footprint as direct service access. Setup detects an adjacent path and opens the service ride without placing a separate entrance or exit.

### Things to Know

- Pending creation records existing ride IDs before a request so the next snapshot can identify the newly created instance even when multiple rides share a type.
- A stall or facility with no adjacent public path remains closed and reports that a path must be built beside it. Its internal entrance coordinate denotes the path access tile, not a separate entrance object.

Created and maintained by Nori.
