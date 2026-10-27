# PR #150 guest ride-choice proof

`before/` copies the `pr-149/after` main-branch captures: same queue-spacing build and crowded walkway scenario, before this change. `after/` contains captures from PR #150 at default camera zoom, plus the 1,000-guest simulation samples.

## Renderer captures

- `before/webgl2.png`, `before/canvas2d.png`: main / PR #149 baseline, rotation 0.
- `after/webgl2.png`, `after/canvas2d.png`: PR #150, rotation 0.
- Canvas2D captures use `canvas.toDataURL('image/png')`; WebGL2 captures use the canvas screenshot.

## Simulation samples

The simulation runs one free Merry-Go-Round with a 56-person queue for 8,000 ticks. `queued` counts guests physically on the queue, `approaching` counts guests assigned to the ride and walking over public paths, and `committed` is their sum. Nearby-path guests counts everyone on a non-queue path tile within one tile of the queue join.

At tick 1,000, queued plus approaching guests reached the 56-person capacity. At tick 8,000, 28 were physically queued and 28 were approaching; peak physical queue occupancy was 38. Across the 100-tick path samples, no guest remained at the same position for 300 ticks. The regression test bounds this count at 12. Up to 69 guests still moved through the measured adjacent path area; the bounded metric is stationary loitering, not total path traffic.

At the end: 68 guests targeted the ride, 867 could still afford its zero ticket price, none had last ridden it, and 12 had recent ride history. Among remaining guests, preference buckets were low/mid/high: 166/418/283; nausea-tolerance buckets: 128/525/214; intensity-eligible: 867; minimum happiness: 255; minimum energy: 177; maximum nausea: 0. All 1,000 guests initially passed the affordability, intensity, nausea and queue-room gates. The entrance path was reachable and the open end was a queue tile, which is excluded from ordinary public-path reachability.

The pre-change simulation ended with 12 guests queued and none approaching after 8,000 ticks. The old `-100 x line length` score term made already committed guests suppress the ride's score early. The new `-100 x line length / capacity` term allows a modest line to remain attractive while maintaining the existing full-capacity filter. The regression test logs choice and path diagnostics.

## OpenRCT2 comparison

- [Guest ride consideration and choice](https://github.com/OpenRCT2/OpenRCT2/blob/aca477060424cc9f2e3d925fa3b13f84f4fbf3f7/src/openrct2/entity/Guest.cpp#L1790-L1874): nearby/known rides, skip previously ridden and `queueFull`, choose the eligible ride with highest excitement.
- [Ride popularity updates](https://github.com/OpenRCT2/OpenRCT2/blob/aca477060424cc9f2e3d925fa3b13f84f4fbf3f7/src/openrct2/ride/Ride.cpp#L913-L932): popularity is recorded separately from chooser ranking.
- [Queue entry and `queueFull`](https://github.com/OpenRCT2/OpenRCT2/blob/aca477060424cc9f2e3d925fa3b13f84f4fbf3f7/src/openrct2/entity/Guest.cpp#L1907-L1947): reactive full-queue behavior; no maximum displayed queue-time cutoff found.
- [Queue-end pathfinding](https://github.com/OpenRCT2/OpenRCT2/blob/aca477060424cc9f2e3d925fa3b13f84f4fbf3f7/src/openrct2/peep/GuestPathfinding.cpp#L2042-L2100): route to the last connected queue tile.
- [Heading-for ride action](https://github.com/OpenRCT2/OpenRCT2/blob/aca477060424cc9f2e3d925fa3b13f84f4fbf3f7/src/openrct2/entity/Peep.cpp#L1310-L1318): per-ride “heading for” counts can be derived from the guest's target ride.

OpenRCT2 is a reimplementation, so these sources are a comparison target rather than proof of every original RCT2 binary detail.
