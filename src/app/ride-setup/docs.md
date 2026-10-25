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
- Flat rides, stalls and track rides follow their respective entrance/exit or track-construction setup paths.

### Things to Know

- Pending creation records existing ride IDs before a request so the next snapshot can identify the newly created instance even when multiple rides share a type.
- Stall and facility entrances are oriented toward adjacent paths when one can be found; otherwise placement remains an explicit follow-up step.

Created and maintained by Nori.
