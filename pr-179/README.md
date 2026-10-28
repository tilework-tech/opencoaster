# Sandbox entrance and guest arrival proof

These captures were taken in the real game UI on the feature branch.

- `sandbox-before.png` and `sandbox-before-canvas.png`: baseline sandbox after two in-game minutes, with 999 guests scattered across the map and no park gate.
- `sandbox-after-2-minutes.png` and `sandbox-after-2-minutes-canvas.png`: fixed sandbox after two in-game minutes, with a map-edge spawn, connected approach path, gate, and guests entering through the gate.

The browser loaded these sprite categories before the after capture: coaster-junior, coaster-mouse, coaster-steel, coaster-wood, flat-rides, people, stalls, track-chairlift, track-miniature-railway, track-monorail, transport, vehicles, water-log-flume, water-river-rapids, and world.

The session browser did not provide WebGL2, so the game rendered through its Canvas2D fallback. The screenshots show that actual rendered UI.
