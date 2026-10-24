# sim/pathfinding

Responsibility: deterministic, allocation-free path queries over the tile map for guests and staff.

Interface: `Pathfinder.findPath(map, from, to, out)`; `nullPathfinder` placeholder. Implementations must break ties deterministically and be time-budgeted per tick.
