# sim/pathfinding

Responsibility: deterministic, allocation-free navigation over the footpath graph for guests and staff. Spec: `docs/mechanics/guests.md` section 2.5 (P-1..P-9) and `world.md` staff patrol.

## Interface

- `nextDirection(world, tile, target, rng, opts?) -> DIR_E | DIR_S | DIR_W | DIR_N | DIR_NONE`. Pass `target < 0` to wander. `DIR_NONE` means the tile is not a path, is the target, or the target is in another connected component (callers should retarget).
- `isReachable(world, from, to, patrol?)`: O(1) via cached component labels; with a patrol mask it runs a BFS confined to the mask.
- `NavOptions` (reuse one object per caller; nothing is allocated): `fromDir` (no reversing unless dead end), `maxJunctions`, `maxTiles`, `maxDistance`, `stepsTaken` / `lostAfter`, `patrol` (per-tile `Uint8Array` mask). Presets: `DEFAULT_GUEST_OPTS` (6 junctions, 15,000 tiles, radius 200), `DEFAULT_STAFF_OPTS` (16 junctions, 50,000 tiles).
- `PathGraph` (`graph.ts`): `width`, `height`, `pathVersion`, `edgeMask(tile)` (bits E,S,W,N). `world.map` may be a `PathGraph` or a real `TileMap`; a `TileMap` is adapted by treating `Surface.Path` tiles as connected to their path neighbours. **Map editors must call `markPathsChanged(map)` after any path edit** (PathGraph implementations bump `pathVersion` instead).
- The old `Pathfinder.findPath` / `nullPathfinder` contract in `pathfinder.ts` is retained for compatibility and unused.

## How it works

- `PathNetwork` (one per graph, in a `WeakMap`, not world state) caches _corridor links_: from any (tile, dir), the junction or dead end reached by following degree-2 tiles, with length and arrival direction. Links fill lazily and are dropped when `pathVersion` changes. It also holds component labels and all search scratch (typed arrays), so queries do not allocate.
- Goal-directed guest step: remove the reverse of `fromDir`; a single remaining exit is returned without searching (P-5: single-exit tiles consume no junction budget). Otherwise a breadth-first search over junction nodes (at most `maxJunctions` expansions, P-1) scores each reached node by Manhattan distance to the target (0 = target found on a corridor); each first step keeps its best (score, steps); lowest wins, ties break by fewer steps then `rng`. A target within the budget is found; one beyond it is approached greedily, so guests can take wrong turns. Past `lostAfter` steps a guest is lost and wanders.
- Wander: uniform random among non-reversing exits.
- Staff patrol: with `opts.patrol`, movement uses tile-level BFS confined to the mask (nothing leaves the area); wandering picks mask-internal exits; a staff member outside the mask walks to the nearest mask tile.
- Ties and wandering draw only from the caller-supplied `rng`; caches are pure functions of the graph, so results are deterministic.

## Deviations / notes

- Score is Manhattan distance, not the spec's min(|dx|,|dy|)/16 formula, and has no height term (the graph has no heights yet). Guest junction budget is 6 (16 - 10, P-1); lost threshold is a caller-supplied tunable (P-8 unverified).
- Queue-path rules (P-4) and sloped paths are not modelled: the `PathGraph` provider decides which edges exist. Queue-targeted search needs a graph that exposes queue edges.
- `fixture.ts` (`GridPathGraph`) is a test/bench fixture only; `bench/pathfinding.ts` is a standalone micro-benchmark (`npx tsx bench/pathfinding.ts`).
