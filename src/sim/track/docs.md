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
- [construction.ts](construction.ts) derives the current tail cursor, validates connection and map geometry, places/removes pieces, and detects circuit completion. For obstruction checks it turns each rotated piece-footprint cell, including its catalog support/base extent, into a world-height interval and checks it against the shared [map occupancy model](../map/docs.md). Consecutive station pieces are allowed.
- [track-commands.ts](track-commands.ts) applies ride-family and mode rules, generic geometry validation, rotated footprint water and ownership checks, and funds validation. Successful placement charges construction cost and invalidates the ride's test; removal also invalidates testing. Direct construction helpers do not apply command-only checks or charges.
- Transport rides share `TRANSPORT_PIECES` from [catalog.ts](catalog.ts): unbanked, noninverted pieces with slopes up to 25 degrees. Railway, monorail, and chairlift curves are buildable and have generated track art; banks, steep slopes, and inversions are filtered from the builder and rejected by simulation rules.
- Track heights use RCT2's finer track grid: placed piece `z`, piece `dz` and `PlaceRequest.z` count track steps of `TRACK_Z_STEP` (half a land level, `TRACK_STEPS_PER_LEVEL` per level, from [core/constants.ts](../core/constants.ts)), while land, paths, water, `MAX_TRACK_LEVEL`, ride-type `maxLevel` and `CLEARANCE_UNITS` stay in whole land levels or world units. Height checks convert both sides to world units.
- Piece rises in [catalog.ts](catalog.ts) are explicit RCT2 values taken from OpenRCT2's track coordinate table (`src/openrct2/ride/TrackData.cpp`), not derived from the curve: straights look up `STRAIGHT_RISE` by entry/exit slope class (flat to 25 degrees half a level, 25 degrees one level, 25 to 60 degrees two, 60 degrees four), sloped quarter turns use `SLOPED_TURN_RISE` by radius, helices climb two levels per full turn, and loops, S-bends and level corkscrews are level. `GRADE` (0.25 and 1 rise per run) only shapes the sampled profile. A straight slope pair with no RCT2 entry throws at catalog build.
- Because flat-to-25-degree transitions rise half a level, any whole land-level difference between a circuit's ends is reachable by flat-to-flat track; flat pieces such as stations land on whole levels by chaining, as in RCT2.
- [track-path.ts](track-path.ts) assembles the connected piece samples into a world-space path for vehicle simulation. [track-system.ts](track-system.ts) removes track when its ride no longer exists, including after ride demolition.
- [track-height-migration.ts](track-height-migration.ts) converts saves from before track steps (see [save](../../save/docs.md)): each chain's first station (or its head when it has none) keeps its world height, the rest of the chain is re-laid from it with the current rises, and `relinkRide` from [construction.ts](construction.ts) recomputes start arclengths and length. A ride with any sloped or rising piece goes through `invalidateRideTest` (closed, trains removed, must be tested again), since its stored test describes the old layout. A closed circuit whose pieces no longer meet at the station is reopened there.

### Things to Know

- Migrated legacy layouts have slopes half as steep as before, so elevated sections end lower and can pass into terrain; land and clearance checks are not re-run on load.
- Generic placement checks connection, piece capacity, map bounds, height, terrain/tunnel allowance, and clearance against all indexed construction types, not only track. Track clearance is currently three `Z_STEP`s above each cell's catalog `zMax`, expressed as world units so it is independent of the track catalog's height-level convention. `track-commands.ts` surfaces the shared blocker name in feedback; the UI preview evaluates the same candidate volumes against the snapshot occupancy list and colors an obstructed ghost red. See [map occupancy](../map/docs.md) for the interval exceptions and OpenRCT2 references.
- Terrain below the map surface remains a valid tunnel placement when the piece passes the track's terrain/tunnel checks; occupancy comparison is between built elements, so underground track is not rejected merely for being below terrain.
- Track over open water is allowed only when the ride type declares `allowsWater`; Log Flume and River Rapids are tracked water rides with that capability. Other coasters remain blocked from placing any part of a piece footprint over open water.
- `WaterLift` is restricted to uphill pieces on water rides, and `ChainLift` is rejected on water rides. Ride-specific piece lists and slope, inversion, launch, and height limits are enforced at the command boundary.
- The generated [track coverage matrix](../../../docs/art/track-coverage.md) lists every catalog piece against each tracked ride type, including slope and bank transitions, builder restrictions, sprite availability, and the four direction-by-camera-view combinations.
- Changing track invalidates `tested`, so track rides must pass another vehicle test before opening. A complete circuit also needs a station, and every station tile is considered for entrance/exit placement.

- Tunnels: track may run below the terrain (`TunnelOk` pieces), but [clearance.ts](clearance.ts) finds every tile where the centre line dips under the interpolated ground (`undergroundTiles`) and the command path refuses (`TrackResult.TunnelBlocked`) a section that would pass under a ride footprint, a footpath or water. `pieceTunnelPortals` returns where a piece's centre line crosses the surface, with the direction the portal faces; renderers and the build preview use the same functions over `heights`/`slope`, so they agree with the sim. Land edits already refuse to change ground within two levels of (or above) any track piece (`structureConflict`), which protects tunnel sections.

Created and maintained by Nori.
