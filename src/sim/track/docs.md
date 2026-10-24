# sim/track

Responsibility: track piece definitions, placement/validation and the sampled centre-line used by vehicles.

Interface: `TrackPieceDef` (integer waypoints), `TrackPlacement`, `trackSystem`. Vehicles consume waypoints; they never recompute spline geometry at runtime.
