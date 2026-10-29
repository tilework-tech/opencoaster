# Noridoc: Simulation Pathfinding

Path: @/src/sim/pathfinding

### Overview

- Provides deterministic, allocation-free navigation over the footpath graph for guests and staff.
- Uses directional edge masks to represent walkable links, including boundaries blocked by wall scenery.
- Implements guest navigation rules in [docs/mechanics/guests.md](../../../docs/mechanics/guests.md) and staff patrol movement in [docs/mechanics/world.md](../../../docs/mechanics/world.md).

### How it fits into the larger codebase

- Guest and staff systems request next directions and reachability from this module; it reads the map graph without changing world state.
- [The simulation map](../map/docs.md) implements `PathGraph` directly. Its `TileMap.edgeMask` cache uses `pathVersion`, which advances when paths or wall scenery changes; the graph adapter is only for map objects without their own edge-mask method.
- Stacked footpaths (a bridge over another path) are separate nodes: a tile has up to `WALK_LAYERS` (3) nodes, one per path element ranked from the lowest, so a route over a bridge never joins the path beneath it. Guests pick their node from their height with `TileMap.walkNode`.
- Queue paths stay outside ordinary walking routes; a wall removes only the crossing along its occupied boundary, leaving other exits usable.

### Core Implementation

- [navigate.ts](navigate.ts) exposes `nextDirection`, `isReachable`, navigation options and the last search outcome. Callers supply the random generator so tie-breaking and wandering remain deterministic.
- [graph.ts](graph.ts) defines the `PathGraph` contract and a compatibility `TileMapPathGraph` adapter. A graph may number its nodes `layer * tiles + tile` by declaring `nodeCount` and `step(node, dir)`; `nodeCount`, `stepNode` and `nodeTile` fall back to one node per tile and adjacent-tile steps, and every search, link walk and component label goes through them instead of assuming `tile + dx + dy * width`. `edgeMask` takes a graph node ID, not a tile index: for layered maps the layer is part of the ID used to read exits. Production maps use `TileMap.edgeMask` from [tile-map.ts](../map/tile-map.ts), which caches E/S/W/N walk edges per node and masks a connection when either tile has a wall on the shared boundary. Checking both sides keeps adjacent tiles' graph views symmetric; the cache is rebuilt when `pathVersion` changes.
- `PathNetwork` caches corridor links and connected-component labels per graph in a `WeakMap`, with reusable typed-array search scratch. A `pathVersion` change rebuilds those derived results without putting navigation caches into saved world state.
- Goal-directed searches expand junctions under a configurable budget and rank routes by distance to the target. Corridor tiles do not consume the budget; when the target falls beyond the search budget, the best known first step guides a greedy approach.
- Wandering chooses uniformly among non-reversing open edges. Staff movement with a patrol mask uses a tile-level BFS confined to that mask; guests and staff therefore inherit wall blocking through the same edge-mask contract.

### Things to Know

- A step from a node lands on the neighbouring element whose edge height meets its own (`TileMap.adjoiningPath`), so a ramp joins the level piece at its top and a bridge's deck stays apart from the ground path it crosses. Traversals must pass the current node to `edgeMask` and use `stepNode` for each permitted exit; a tile index discards the layer and can combine exits from a different path. Heuristic distances (`distanceScore`, `chebyshev`) compare the nodes' tiles, not their layers. A tile with more than `WALK_LAYERS` paths exposes only its lowest three.
- Path and wall element insertion or removal advances the production map's `pathVersion`, invalidating both its cached edge masks and this module's derived corridor links and component labels.
- Queue tiles expose no ordinary walking exits. Guests route to the ordinary path tile where a ride queue joins the main path, then enter the queue through the ride queue system.
- A ride exit is walkable only for guests leaving the ride: the map exposes its front edge as an exit and hides every edge leading into it. `PathNetwork` places such a source-only node in the component of the path it feeds and `isReachable` never reports it as a destination. Ride entrances are queue pieces, so they are outside the walking network like any queue tile.
- [fixture.ts](fixture.ts) provides a grid graph for tests and benchmarks. The legacy `Pathfinder.findPath` contract remains for compatibility and is not used by current consumers.

Created and maintained by Nori.
