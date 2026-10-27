# Noridoc: Track

Path: @/src/sim/track

### Overview

- Defines the track-piece catalog, deterministic geometry, construction validation, and each ride's connected track layout.
- Supplies cached world-space track paths to [vehicles](../vehicles/docs.md), which handle train movement and measurements.
- Keeps ride-family rules, ownership, water access, and charging in the track command boundary.

### How it fits into the larger codebase

- [track-store.ts](track-store.ts) stores pieces and per-ride layout metadata in the world; [core/hash.ts](../core/hash.ts) and [save/save.ts](../../save/save.ts) include this durable simulation state.
- The command layer is called through [core/simulation.ts](../core/simulation.ts). It combines generic geometry checks with ride rules, map ownership, open-water capability, and economy charging.
- [coaster-system.ts](../rides/coaster-system.ts) and [vehicles](../vehicles/docs.md) consume [track-path.ts](track-path.ts)'s sampled centerline. Path data is derived and cached by layout version rather than stored in saves or the world hash.
- [rides](../rides/docs.md) owns ride types, test status, and station boarding requirements; every station piece footprint can provide boarding candidate locations.

### Core Implementation

- [catalog.ts](catalog.ts) builds immutable piece definitions and shared sampled geometry. Each piece defines entry and exit position, direction, slope and bank, height change, flags, cost, and footprint. Appended piece IDs preserve existing save references.
- [geometry.ts](geometry.ts) creates integer-compatible centerline samples for straight, curved, sloped, banked, inverted, and water-drop shapes. The build controls select pieces by shape and compatible entry/exit state.
- [construction.ts](construction.ts) derives the current tail cursor, validates connection and map geometry, places/removes pieces, and detects circuit completion. Consecutive station pieces are allowed.
- [track-commands.ts](track-commands.ts) applies ride-family and mode rules, generic geometry validation, rotated footprint water and ownership checks, and funds validation. Successful placement charges construction cost and invalidates the ride's test; removal also invalidates testing. Direct construction helpers do not apply command-only checks or charges.
- Transport rides share `TRANSPORT_PIECES` from [catalog.ts](catalog.ts): unbanked, noninverted pieces with slopes up to 25 degrees. Railway, monorail, and chairlift curves are buildable and have generated track art; banks, steep slopes, and inversions are filtered from the builder and rejected by simulation rules.
- [track-path.ts](track-path.ts) assembles the connected piece samples into a world-space path for vehicle simulation. [track-system.ts](track-system.ts) removes track when its ride no longer exists, including after ride demolition.

### Things to Know

- Generic placement checks connection, piece capacity, map bounds, height, terrain/tunnel allowance, and clearance against other track. The command path adds ride type restrictions, ownership, available funds, and open-water checks.
- Track over open water is allowed only when the ride type declares `allowsWater`; Log Flume and River Rapids are tracked water rides with that capability. Other coasters remain blocked from placing any part of a piece footprint over open water.
- `WaterLift` is restricted to uphill pieces on water rides, and `ChainLift` is rejected on water rides. Ride-specific piece lists and slope, inversion, launch, and height limits are enforced at the command boundary.
- The generated [track coverage matrix](../../../docs/art/track-coverage.md) lists every catalog piece against each tracked ride type, including slope and bank transitions, builder restrictions, sprite availability, and the four direction-by-camera-view combinations.
- Changing track invalidates `tested`, so track rides must pass another vehicle test before opening. A complete circuit also needs a station, and every station tile is considered for entrance/exit placement.

- Tunnels: track may run below the terrain (`TunnelOk` pieces), but [clearance.ts](clearance.ts) finds every tile where the centre line dips under the interpolated ground (`undergroundTiles`) and the command path refuses (`TrackResult.TunnelBlocked`) a section that would pass under a ride footprint, a footpath or water. `pieceTunnelPortals` returns where a piece's centre line crosses the surface, with the direction the portal faces; renderers and the build preview use the same functions over `heights`/`slope`, so they agree with the sim. Land edits already refuse to change ground within two levels of (or above) any track piece (`structureConflict`), which protects tunnel sections.

Created and maintained by Nori.
