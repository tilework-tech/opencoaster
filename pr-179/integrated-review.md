# Integrated sandbox and ambient-tree review

Captured from the integrated sandbox-plus-trees branch in the real session browser after starting a sandbox. The screenshot shows the park gate connected to its map-edge approach, with clustered ambient trees clear of the path and forest belts around the map. Canvas2D rendered the game because WebGL2 was unavailable in this browser.

All 15 sprite atlas categories were fetched and verified: coaster-junior, coaster-mouse, coaster-steel, coaster-wood, flat-rides, people, stalls, track-chairlift, track-miniature-railway, track-monorail, transport, vehicles, water-log-flume, water-river-rapids, and world. All 34 atlas pages and their 34 depth pages loaded successfully.

Automated integration tests cover v32 fallback, v33 spawn/guest preservation, v34 deterministic tree migration and idempotent reload, and occupied path, ride, track, and station tiles. Existing ambient-tree tests verify removal through the scenery path.
