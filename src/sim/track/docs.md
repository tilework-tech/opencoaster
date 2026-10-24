# sim/track

Responsibility: track piece catalog and geometry, construction (cursor, validation, placement, removal, circuit detection) and the polyline the vehicle system follows. Implements `docs/mechanics/track.md` sections 2.1-2.3 and 3.1-3.2; train physics, ratings and crashes belong to `vehicles`/`rides`.

## Files

| File                | Contents                                                                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `track-types.ts`    | `Slope`, `Bank`, `PieceMode`, `PieceFlag`, `TrackResult` enums; `TrackPieceDef`, `FootprintCell`.                                                                                 |
| `geometry.ts`       | Build-time curves (straight, Bezier quarter arc, vertical loop, Hermite height profile). Uses only `+ - * / sqrt`, so the generated integer tables are identical on every engine. |
| `catalog.ts`        | `PIECES` (34 piece types), `PieceId`, `SAMPLES` (shared SoA centre-line table), `pieceByName`. Built once at module load.                                                         |
| `track-store.ts`    | `TrackState` (`world.track`): `pieces` EntityStore plus per-ride `head/tail/count/closed/length/version`.                                                                         |
| `construction.ts`   | Cursor, `validatePlacement`, `placeTrack`, `removeTrack`, `removeRideTrack`, `circuitStatus`.                                                                                     |
| `track-path.ts`     | `getTrackPath(world, rideId)`: cached world-space polyline for vehicles.                                                                                                          |
| `track-commands.ts` | `applyTrackCommand`: place/remove with ride rules, ownership, funds.                                                                                                              |
| `track-system.ts`   | Per-tick upkeep: removes the track of rides that no longer exist.                                                                                                                 |

## Piece model

Pieces sit on the tile grid (the map's tile, `TILE_UNITS = 256` units; height level `Z_STEP = 64` units). A piece is defined in a local frame: entry at the west edge midpoint of its origin tile `(0, 128)`, heading +x, entry height 0. Placement rotates it by `dir` (0=+x, 1=+y, 2=-x, 3=-y) about the origin tile. "Right" is +1 quarter turn (toward +y in the local frame), "left" is -1.

Each `TrackPieceDef` records entry/exit slope class, entry/exit bank class, heading delta, exit tile offset `(dx, dy)`, height delta `dz` (levels), flags, cost, length and its range in `SAMPLES`. Two pieces connect iff exit position, heading, slope class and bank class match.

Catalog: station; flat; slopes 25 and 60 up/down with all flat<->25<->60 transitions (12); small/medium/large curves left/right (radius 1.5/2.5/3.5 tiles, exit offsets `(1,±2)`, `(2,±3)`, `(3,±4)`); flat<->bank transitions and banked straights; banked small/medium/large curves; left/right vertical loop (a 5-level circle with a one-tile forward drift and a one-tile lateral shift so the legs pass side by side; exit is one tile ahead, one tile to the side).

Slope classes: 25 = 0.5 rise/run (26.6 degrees), 60 = 2.0 rise/run (63.4 degrees), so every piece rises a whole number of height levels. Bank is 45 degrees (`BANK_DEG`); left banks are negative.

Per-instance `mode` (`PieceMode`): Normal, ChainLift (flag `LiftOk`: flat and upward slopes), Brake and BlockBrake (flag `BrakeOk`: flat only), Launch (`PieceMode.Launch`, flag `LaunchOk`: flat pieces only). Stations take no mode.

## Sample table (what vehicles consume)

`SAMPLES` holds, per point: `x,y,z` (units, local frame), `tx,ty,tz` (unit tangent x 1024, `TANGENT_ONE`), `bank` (degrees, smoothstep between end classes). Points are spaced ~32 units apart by arclength, both end points included.

`getTrackPath(world, rideId)` returns a `TrackPath`: world-space `x,y,z`, tangents, `bank`, cumulative arclength `s`, per-point `mode` and owning piece id, and `pieceStart` indices. Closed circuits repeat point 0 at the end (`s === length`), so wrap with `s % length`. Paths are cached per ride and rebuilt when `TrackState.version` changes; vehicles should hold the object and compare `path.version` if they cache indices. Pitch is `atan2(tz, hypot(tx, ty))`; in a loop the horizontal tangent reverses (inverted section) while the track still progresses.

## Construction

`getConstructionCursor(world, rideId)` gives the position, heading, height level, slope and bank at the tail; `connectablePieces(cursor)` lists the piece types that fit. `validatePlacement` returns a `TrackResult`:

1. Ride must exist (`world.rides`) and not be a closed circuit; piece-count cap `MAX_PIECES_PER_RIDE` (2048); store capacity `MAX_TRACK_PIECES` (16384).
2. Mode allowed by the piece flags.
3. Connection: the first piece goes anywhere; later pieces must meet the tail cursor (append) or have an exit that meets the head's entry (prepend). A piece whose exit meets the head while appended closes the circuit.
4. Footprint (tiles touched by the centre line, rasterised in the local frame and rotated): inside the map, lowest point at or above height 0, above terrain unless the piece has `TunnelOk` (then it is a tunnel), highest point at most `MAX_TRACK_LEVEL` (96) levels.
5. Clearance: each footprint cell occupies `[zMin, zMax + CLEARANCE_UNITS]` (3 levels) on its tile; overlap with any cell of any ride is `Blocked`.

`removeTrack(world, rideId, pieceId)`: `-1` removes the tail. An open chain only loses an end piece (`NotAtEnd` otherwise); any piece of a closed circuit can go and reopens it. `circuitStatus` reports pieces, closed, station count, `complete` (closed with a station) and length.

## Commands

Commands: `{ type: 'placeTrack', rideId, pieceType, x, y, z, dir, mode }` and `{ type: 'removeTrack', rideId, pieceId }`. `applyTrackCommand` owns the whole command, including charging; the core dispatcher no longer pre-checks funds. The outcome goes to `world.track.lastResult` / `lastPiece` (saved) and to `world.feedback` with `FeedbackDomain.Track` (see [core](../core/docs.md)). `TrackResult` includes `NotOwned`, `InsufficientFunds` and `PieceNotAllowed` for the command-only checks.

`validatePlaceCommand` checks, in order:

1. Ride-type rules from `RideTypeDef.trackRules` (`maxLevel`, `steepSlopes`, `inversions`, `launch`) -> `PieceNotAllowed`.
2. Geometry via `validatePlacement`.
3. Ownership of every footprint tile via `map.canBuild` -> `NotOwned`.
4. Funds -> `InsufficientFunds`.

A valid piece is placed and charged through the economy `charge`, then `invalidateRideTest` clears the ride's tested state. Removal also invalidates the test. Direct `placeTrack()` / `removeTrack()` calls (tests, fixtures) skip ownership, ride rules and charging; only commands enforce them. UIs call `validatePlacement` first for hover feedback, but the command result is authoritative.

## Determinism and state

All stored state is integers (`TRACK_SCHEMA`, per-ride tables); both are in `hashWorld` and written by `src/save` (`pieces.arrays()` + `rideTables()` plus `lastResult`/`lastPiece`). Catalog floats exist only at module load and use correctly-rounded operations. `paths` is derived and not hashed.

## Known limits / follow-ups

- `validatePlacement` itself is rule-agnostic; ride-type limits and ownership live only in the command path.
- Supports, tunnel portals, and collision with paths/scenery (tile `flags`) are not modelled.
- Corkscrews, helixes, barrel rolls, S-bends, diagonal pieces, slope+bank combinations and half-tile grid positions are not in the catalog; pieces are whole-tile.
