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
- Observation Tower placement keeps an 8–64 level height selection and a price label in step with the worker's authoritative construction command, passes `towerHeight` with the create command, and previews the ghost at that height. The height control is refreshed every frame from `drawRidePlacementPreview`, so it appears as soon as the ride type is chosen.
- Flat rides and track rides, including Log Flume and River Rapids, place entrances and exits around the complete ride footprint or all coaster station-piece footprints. Candidate geometry and visible validity are derived from the snapshot, while the worker validates each placement command. A candidate tile is shown as occupied when a track piece footprint cell sits within two land levels above its ground; snapshot track z is already in world units, so it is compared directly against `Z_STEP`-scaled ground heights.
- Valid and invalid boarding candidates remain pointer and keyboard targets. Their accessible labels and status feedback identify the blocking condition; worker feedback is retained instead of being replaced by the next generic prompt.
- After the exit of a flat ride is placed and its queue is not yet connected to a path, setup prompts for the queue: it opens Footpaths in line mode with Queue line on, pulses a highlight on the entrance tile and clears the prompt when the ride's queue connects or the player leaves the Footpaths tool. The ride window's "Build queue" action starts the same prompt (`promptQueue`).
- Stalls and facilities have no entrance or exit step. The placement ghost carries a facing: until the player turns it, `autoStallFacing` points the window at a usable footpath (current facing first, then +x, +y, -x, -y, following OpenRCT2's auto-rotation), and once the player presses T or the "Rotate stall (T)" button (also shown on touch) the chosen facing is kept. The facing is sent with `createRide` as the ride's `dir`; the worker opens the stall on creation.
- The stall preview overlay outlines the front tile (green when it serves guests, red otherwise) and draws a T-shaped arrow out of the window edge. The verdict comes from `stallFrontProblemInMap` over the snapshot map (see [rides](../../sim/rides/docs.md#stall-storefronts)), so the preview and the simulation apply one rule. Tool status names the window's screen direction in the current camera view and either the serving footpath or the exact reason it would not serve.
- After a stall is built, status reads "X is open, serving from the footpath at x, y" or "X is open but guests cannot reach it: <reason>", from the snapshot's `RideInfo.Dir` and `RideInfo.StallFront`. The built stall's front stays highlighted while the cursor remains on its tile, then the preview resumes.

### Things to Know

- Pending creation records existing ride IDs before a request so the next snapshot can identify the newly created instance even when multiple rides share a type.
- A stall whose front has no usable footpath is still open; guests ignore it until a path serves its window. Its internal entrance coordinate is always the front tile, not a separate entrance object.
- An entrance placement requested for a stall still sends `placeRideEntrance`; the worker treats it as "turn to face this tile" and refuses with the reason when that front would not serve, and setup reports the turn as "X now faces its footpath".

Created and maintained by Nori.
