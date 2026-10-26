# sim/pathfinding

Responsibility: deterministic, allocation-free navigation over the footpath graph for guests and staff. Spec: `docs/mechanics/guests.md` section 2.5 (P-1..P-9) and `world.md` staff patrol.

## Interface

- `nextDirection(world, tile, target, rng, opts?) -> DIR_E | DIR_S | DIR_W | DIR_N | DIR_NONE`. Pass `target < 0` to wander. `DIR_NONE` means the tile is not a path, is the target, or the target is in another connected component (callers should retarget).
- `isReachable(world, from, to, patrol?)`: O(1) via cached component labels; with a patrol mask it runs a BFS confined to the mask.
- `NavOptions` (reuse one object per caller; nothing is allocated): `fromDir` (no reversing unless dead end), `maxJunctions` (a cost budget, see below), `maxTiles`, `maxDistance`, `stepsTaken` / `lostAfter`, `patrol` (per-tile `Uint8Array` mask). Presets: `DEFAULT_GUEST_OPTS` (junction budget 16, 15,000 tiles, radius 200), `DEFAULT_STAFF_OPTS` (junction budget 16, 50,000 tiles).
- `lastSearchOutcome() -> SearchOutcome`: what the last `nextDirection` call knew. `Seen` = the search found the target; `Blind` = it ended without finding it, so the step was a guess; `Unsearched` = wandering, a single exit, or no step. The guest system reads it to tell a guest that is merely walking a long way from one that is lost.
- `PathGraph` (`graph.ts`): `width`, `height`, `pathVersion`, `edgeMask(tile)` (bits E,S,W,N). `world.map` may be a `PathGraph` or a real `TileMap`; a `TileMap` implements `PathGraph` itself (`edgeMask` = the tile's walkable exits, cached per `pathVersion`, `pathVersion` bumped by every path edit in `sim/map`), so map editors need not call `markPathsChanged`. The `Surface.Path` adapter remains only for maps that do not expose `edgeMask`. **Map editors must call `markPathsChanged(map)` after any path edit** (PathGraph implementations bump `pathVersion` instead).
- The old `Pathfinder.findPath` / `nullPathfinder` contract in `pathfinder.ts` is retained for compatibility and unused.

## Consumers

- [Guests](../guests/docs.md) call `nextDirection` at each tile centre with `DEFAULT_GUEST_OPTS` (junction budget raised for guests holding a park map) and `isReachable` before choosing a destination; they use `lastSearchOutcome` to decide when a guest is lost. The old `Pathfinder.findPath` contract is no longer used anywhere.

## How it works

- `PathNetwork` (one per graph, in a `WeakMap`, not world state) caches _corridor links_: from any (tile, dir), the junction or dead end reached by following degree-2 tiles, with length and arrival direction. Links fill lazily and are dropped when `pathVersion` changes. It also holds component labels and all search scratch (typed arrays), so queries do not allocate.
- Goal-directed guest step: remove the reverse of `fromDir`; a single remaining exit is returned without searching (P-5: single-exit tiles consume no junction budget). Otherwise a breadth-first search over junction nodes scores each reached node by the original distance score (below; 0 = target found on a corridor); each first step keeps its best (score, steps); lowest wins, ties break by fewer steps then `rng`. Budget (P-1, O-57): reaching a junction costs 1, or 2 when the corridor leading to it was a stretch with no choice (more than one step); corridor tiles are free; a junction is expanded only while the cost of reaching it is at most `maxJunctions`. A target within the budget is found; one beyond it is approached greedily, so guests can take wrong turns.
- Distance score: the smaller of the x and y tile gaps times 2 (the original's 32-unit gap divided by 16), compared first; the larger gap is a secondary tie-break so nodes level with the target on one axis are still ranked by closeness. Without the secondary term a guest cannot tell a dead end level with the target from the route that leads to it.
- Wander: uniform random among non-reversing exits.
- Staff patrol: with `opts.patrol`, movement uses tile-level BFS confined to the mask (nothing leaves the area); wandering picks mask-internal exits; a staff member outside the mask walks to the nearest mask tile.
- Ties and wandering draw only from the caller-supplied `rng`; caches are pure functions of the graph, so results are deterministic.

## Deviations / notes

- The score follows O-59 (smaller axis gap over 16) plus the secondary tie-break above, and has no height term (the graph has no heights yet). The junction budget is 16 cost units, not the 16 - 10 = 6 of the O-57 reading: with spaced junctions costing 2 that left guests unable to see rides past three junctions; the value is tunable and a park map adds to it. The `stepsTaken` / `lostAfter` options are no longer used by guests; lost detection lives in the guest system (see guests docs) because the trigger (O-62) is unverified.
- Queue tiles are not part of the walking network. `TileMap.edgeMask` returns each tile's walkable exits: a queue tile exposes none and no ordinary tile exposes an exit toward one, so wandering guests, leaving guests and staff routes never path through a queue line. Guests heading for a ride path to the ordinary tile where the ride's queue line joins the main path (see [guests](../guests/docs.md)) and step into the line from there. Sloped-path height rules are still left to the `PathGraph` provider.
- `fixture.ts` (`GridPathGraph`) is a test/bench fixture only; `bench/pathfinding.ts` is a standalone micro-benchmark (`npx tsx bench/pathfinding.ts`).
