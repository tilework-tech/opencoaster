# Track, Trains & Ride Testing

Spec for the `track` subsystem of OpenCoaster. Clean-room: everything below is described in our own words from public wikis, forums and issue threads (URLs in section 6). No original assets, decompiled code or OpenRCT2 source were used. Where public sources give no numbers, this document says so and proposes an **original design** with tunable constants instead of guessing at the original's internals.

Confidence tags: **[V]** verified from 2+ sources, **[S]** single source, **[I]** inferred / our design proposal (tune by playtesting).

---

## 1. Overview

The player lays a ride out of **track pieces** on a half-tile grid: straights, slopes, curves of several radii, banking, and special elements (loops, corkscrews, helixes, barrel rolls). A station, a lift (chain) or launch, and brakes make it run. Trains move purely by energy: gravity up/down slopes, friction bleeding speed, lifts/boosters adding it. The game feels like "build, press test, watch the numbers": the ride is run empty, the simulator records max speed, drops, G-forces, airtime, inversions, length; those feed three ratings (excitement, intensity, nausea) that decide guest demand and price. Bad designs stall (not enough energy), crash (too fast over a crest or into another train), or push intensity so high that excitement collapses.

Core loop: construct (validated per piece) -> test (empty train circuits) -> ratings -> open -> guests ride (guest subsystem) -> breakdowns/crashes (rides subsystem).

---

## 2. Precise rules

### 2.1 Track piece system

- Track lives on a grid with a **sub-grid of half a land tile** for piece start/end positions, and horizontal and vertical units are scaled differently. [S] (rctspace TD4 format write-up)
- Height is quantized; RCT2 normally raises track in steps of 2 units (vanilla), with finer steps via mods/tools. [S]
- Piece categories (from gameplay knowledge, all sources agree they exist): flat, slopes (gentle, steep, vertical on some types), turns (tiny, small, medium, large, diagonal, S-bend), bank transitions, banked turns, loops, half/full corkscrews, helixes, barrel rolls, twists (steep twist, inline/heartline), brakes, block brakes, boosters, station, on-ride photo, tunnels. [V]
- **Per-ride-type limits exist** (max slope, max height, allowed pieces), e.g. one ride type has max slope 60 deg and max height 68 ft. [S] Model as a `RideType` capability table.
- Our design [I]: each piece type is a static record: entry/exit grid delta, entry/exit height delta, entry/exit slope class, entry/exit bank class, heading change, flags (inverted, lift allowed, brake allowed, tunnel-able, special-curvature), and a **precomputed centerline sample table** (see 3.3). Construction is a graph walk: a piece can follow another iff exit (slope, bank, heading) == entry (slope, bank, heading).

### 2.2 Construction validation

Public sources give no complete rule list [S: only that "clearance checks" can be toggled off and entrance/exit heights must sit on valid heights]. Proposed ruleset [I]:
1. Entry/exit slope-class and bank-class compatibility (above).
2. Piece must be allowed by ride type, and within ride-type max height / min height above ground.
3. Clearance: occupied voxel columns of the piece must not intersect terrain or other objects, with per-piece clearance heights; a debug flag disables this.
4. Supports: auto-generated from track down to ground per tile; they are cosmetic + cost, but must not collide (reject piece if support column blocked, unless the piece is "no support needed").
5. Tunnels: where track dips below terrain, a tunnel portal is created at entry/exit; only allowed for pieces flagged tunnel-able, entry height within terrain limits. Tunnels count as "sheltered" for scenery/underground-bonus purposes.
6. Station: exactly one entrance and one exit are required for opening; track circuit must be complete for circuit modes.
7. Track length/piece count cap per ride (performance guard).

### 2.3 Stations, lifts, brakes, launches, blocks

- **Station/platform**: trains stop, guests unload/load, depart after the ride-mode condition (minimum/maximum wait, "wait for full load", etc). [I, standard behaviour]
- **Chain lift**: constant-speed drive over lift pieces; pulls a train regardless of slope. Lift speed is a per-ride setting. A forum report says a chain lift on a flat or any non-downhill piece forces a minimum of about 8 km/h. [S weak]
- **Brakes**: clamp speed down toward a target on brake pieces.
- **Block brakes / block sections**: [V, 3+ forum posts] a block section may hold at most one train; a train is held at the brake until the section ahead is clear; a clear block still slows trains to a crawl (about 4 mph reported) [S]. With n blocks you can run at most n-1 trains or nothing moves [S]. The top of a lift hill acts as a block boundary in block mode [S]; splitting a lift adds a block [S]. The brake must be placed where a stopped train can still finish the course. [S]
- **Launch/booster**: adds speed on flagged pieces; launch acceleration is far above real-life values and longitudinal G is not modeled. [S]

### 2.4 Train physics (the game steps the simulation at 40 ticks/s; task requirement)

What public sources establish:
- Movement is energy-like: faster downhill, slower uphill, friction losses. [V] (rct.fandom Car Ride page; OpenRCT2 forums)
- The vehicle "friction" setting is actually **train mass**, which sets frictional losses (heavier = more efficient). Velocity/acceleration only matter for powered vehicles; moment of inertia only for spinning vehicles. Physics classes: powered vs unpowered, and swinging / spinning / neither. [S, moderator post]
- Longer, heavier trains run faster and produce higher forces. [S]
- Known quirks: downward corkscrews can add speed (bug present in the original); looped perpetual-motion exploits exist; loops behave as circles rather than teardrops; gravity model is "very simplistic". [S, S, S]
- Vehicles have a per-type flat-ground top speed (car ride ~3-5 mph). [S]

**Our proposed model [I]** (original; constants tunable):
```
state per train: s (arclength along track, Float32), v (speed along track, Float32)
each tick, dt = 1/40 s:
  slope sin(theta) = lookup(trackSampleTable, s)          // gravity component
  a  = -g * sinTheta                                       // g scaled by GAME_GRAVITY
  a -= frictionCoeff(vehicleType) * (1 + k_mass * trainMass^-1) * sign(v)   // drag
  a -= dragCoeff * v*v
  if onLift:   v = approach(v, liftSpeed, liftAccel*dt)    // overrides physics
  if onBrake:  v = approach(v, brakeTarget, brakeDecel*dt)
  if onBooster: v = approach(v, boostTarget, boostAccel*dt)
  v += a*dt; s += v*dt
  if s past end of piece: advance to next piece (handled by table lookup on global arclength)
```
Use per-train sub-stepping only if speed*dt exceeds the smallest sample spacing. Tune so well-built coasters hit tabled speeds (Section 2.7). Rollback case: if a train crests too slowly (v<=0 on an uphill with no lift) it rolls back and may re-enter the station or collide; the ride should detect "stalled" after N seconds and flag it for the test (ride breaks "didn't finish circuit").

### 2.5 G-forces

Facts: resting vertical G is +1; 0 G is weightlessness (airtime = time at or below 0 G); lateral resting 0, reported as absolute max. [V] Extreme levels about +5 vertical and -2 vertical. [S] G is computed assuming a seated rider; seat tilt ignored; longitudinal G not modeled; forces computed per train, not per car. [S, GitHub issue #9642]

Max speed to stay at or under 2.80 lateral G, by piece [S, rct.wiki] (use as calibration targets for our lateral G function):
| Piece | km/h | mph |
|---|---|---|
| Tiny turn | 45 | 28 |
| Small turn, unbanked | 59 | 37 |
| Medium turn, unbanked | 99 | 62 |
| Diagonal turn, unbanked | 141 | 88 |
| Small turn, banked | 101 | 63 |
| Medium turn, banked | 162 | 101 |
| Diagonal turn, banked | 206 | 128 |
| S-bend | 101 | 63 |
| Half corkscrew | 71 | 44 |
| Steep twist | 91 | 57 |
| Inline/heartline twist | 101 | 63 |
| Barrel roll | 119 | 74 |
| Banked-to-upward-slope transition | 91 | 57 |

Our formulas [I] (standard physics; calibrate curvature tables so the above holds):
```
kappa_h = horizontal curvature at s, kappa_v = vertical curvature (signed, + = valley), bank = roll angle
a_c_lat = v^2 * kappa_h
latG   = | a_c_lat * cos(bank) - g * sin(bank) | / g          // ~0 on perfectly banked turns
vertG  = ( g*cos(pitch) + v^2 * kappa_v ) / g  (inverted: sign handled by roll)
```
Evaluate per train head every tick (or every 2nd tick) and track max +vert, min -vert, max lat, airtime ticks (vertG <= 0).

### 2.6 Collisions and crashes

- Rides with unattached cars crash if a train reaches the **top of a hill** faster than ~31 mph (50 km/h) or **starts a drop** faster than ~40 mph (64 km/h). Flying Turns: 28 / 30 mph. Side-friction coaster: hill top 25 mph (40 km/h). [S, rct.fandom Crash via search snippet; side-friction figure "limit ~30 mph" in a forum is hedged] Note: because cars are unattached on those types, the rule applies to crest and drop-start track transitions, not to every piece.
- Two trains on the same ride crash if their **combined speed >= 30 mph (48 km/h)** on collision, for ride types where crashing is possible. [S]
- Collisions happen via brake failure (breakdown), block override, or too many trains/mis-spaced trains. Crash result: ride closes, guests die/injured, big park-rating hit (economy/guest subsystems).
- Our implementation [I]: only check crash thresholds at crest/drop-start piece boundaries and at train-train gap <= 0; no per-car geometry.

### 2.7 Ride testing and rating pipeline

Public facts:
- Most rides have a test mode; Alpine coaster and flat-style rides (go-karts, mazes) do not, so guests produce the stats. Once stats are final they stop being updated by later guests. [S]
- Stats are recalculated periodically, and a manual override can be erased by recalculation; ratings can lag a few seconds after new test data. [S, S]
- Stats shown/recorded: max speed, average speed, ride time, ride length, max positive vertical G, max negative vertical G, max lateral G, total air time, drops, highest drop height, inversions. [V]
- Rides tolerate up to ~4 minutes of ride time before excitement drops (RCT1). [S]

**Ride-independent rating terms (verified against OpenRCT2 wiki + rct.wiki + forum quote) [V]:**
```
G-force:
  exc  = 0.08*posG - 0.24*clamp(negG, -2.5, 0) + 0.4*min(1.5, latG)
  int  = 0.8*posG  + 0.8*(1 - negG) + latG
  nau  = 0.26*posG + 0.22*(1 - negG) + 0.33*latG
  if latG > 2.8: int += 3.75; nau += 2
  if latG > 3.1: exc *= 0.5; int += 8.5; nau += 4
  (all three then multiplied by ride-type constants)
Drops:
  exc = 0.11*min(9, drops) + 0.0049*highestDrop
  int = 0.14*drops          + 0.0098*highestDrop
  nau = 0.10*drops          + 0.0016*highestDrop
Inversions:
  exc = 0.27*min(6, inv); int = 0.5*inv; nau = 0.22*inv
Scenery (exc only): 0.05 * min(47, itemsWithin5TilesOfStation); underground station = 0.4
Intensity penalty on excitement: for each threshold crossed in {10, 11, 12, 13.2, 14.5}, exc is reduced
```
**Conflict:** the OpenRCT2 wiki page describes each threshold as ×0.75; a rct.wiki / forum summary says each *halves* excitement. Unresolved; default to ×0.75 (primary technical page) and verify by playtest. Vehicle intensity-factor multiplies thresholds (e.g. +10% factor shifts them to 10.78, 11.85, 12.93, 14.23, 15.63). [S]

Terms that exist but have no public numbers (ride-type-specific constants) [S]: max speed (3 constants), average speed (2, nausea unaffected), track length up to a threshold (exc only), train length (exc only, per extra car), proximity bonuses (track near other track, station, paths, scenery, water, loops, interlocking), synchronized stations bonus, minimum-stat penalties (low highest-drop, low speed, few drops, low negative G, low lateral G each divide all three ratings). RCT1 approximate bonuses: nearby rides up to +3, underground up to +2, synchronized stations up to +1.5, water up to +1, music +0.3 (exc). [S]
Our design [I]: pick plausible coefficients per ride class and expose them in a data table so they can be tuned (no attempt to match the original).

Rating bands: Low 0-2.55, Medium 2.56-5.11, High 5.12-7.67, Very High 7.68-10.23, Extreme 10.24-12.79, Ultra-Extreme 12.80+. [V] Guests accept rides up to ~2.30 outside their preferred intensity at 100% happiness; popular rides run intensity ~4.5-6. [S]

Test state machine [I]:
```
Closed -> Testing: spawn empty train, run in the configured mode
Testing: record stats continuously; on first completed circuit (returns to station / completes shuttle) -> compute ratings, stats frozen as "final for this run"
Testing -> Closed if train crashes, stalls > N s, or exceeds time budget -> show "ride is unfinished/crashed" status
Open: continue refining max values from real runs with slow decay of stale test data; recompute ratings every ~N ticks
```

---

## 3. Data model proposal

### 3.1 Static definitions
```ts
type PieceTypeId = number;      // index into struct-of-arrays below
interface PieceTypeTable {      // Int16Array/Float32Array columns, length P (~300)
  dx: Int8Array; dy: Int8Array; dz: Int16Array;      // grid deltas (half-tile units)
  entrySlope: Uint8Array; exitSlope: Uint8Array;
  entryBank: Uint8Array;  exitBank: Uint8Array;
  headingDelta: Int8Array;                           // 0..3 quarter turns, signed
  flags: Uint16Array;                                // INVERTED, LIFT_OK, BRAKE_OK, TUNNEL_OK, CREST, DROP_START...
  sampleStart: Uint32Array; sampleCount: Uint16Array;
}
// shared samples, fixed spacing ds (e.g. 0.1 tile): SoA over all pieces
interface SampleTable { sinPitch: Float32Array; kappaH: Float32Array; kappaV: Float32Array; bank: Float32Array; }
```
### 3.2 Per ride instance
```ts
interface TrackStore {          // all rides' pieces, SoA, length N (grows)
  rideId: Uint16Array; pieceType: Uint16Array;
  x: Int16Array; y: Int16Array; z: Int16Array; dir: Uint8Array;
  nextPiece: Int32Array; prevPiece: Int32Array;     // linked list, -1 = none
  flags: Uint16Array;                               // per-instance: lift, brake, blockBrake, booster
  blockId: Int16Array;
  startS: Float32Array;                             // cumulative arclength at piece start
}
interface TrainStore {          // length T (<= ~1000)
  rideId: Uint16Array; s: Float32Array; v: Float32Array;
  pieceIdx: Int32Array; mass: Float32Array; cars: Uint8Array; state: Uint8Array;
  stateTimer: Uint16Array;
  maxPosG: Float32Array; minNegG: Float32Array; maxLatG: Float32Array;
  airTicks: Uint32Array; maxSpeed: Float32Array; distance: Float32Array;
  drops: Uint16Array; highestDrop: Float32Array; inversions: Uint8Array;
}
interface RideStatsStore { exc: Int16Array; int: Int16Array; nau: Int16Array; /* fixed-point 1/100 */ ... }
```
### 3.3 Per-tick CPU cost
- Train update: one sample lookup + a few multiply-adds per train head (O(T)), T ~ 500 at worst -> ~10^4 flops/tick (< 0.1 ms).
- Block/brake logic: O(blocks), updated only when a train crosses a piece boundary.
- G tracking: per head, per tick: ~20 flops.
- Per-car positions are derived from train s at render time only (not simulated).
- Ratings: computed once per test completion + periodic recompute (O(1) per ride). Construction validation is event-driven, not per tick.
- Rule: no allocations in the tick loop; fixed-point (Int32) or deterministic Float32 ops if we want lockstep determinism; prefer fixed-point in `s`/`v` for replay/multiplayer determinism [I].

---

## 4. Dependencies

- **Rides**: ride modes, opening/closing, breakdowns, maintenance, prices, entrance/exit, queue lengths; ride type tables (limits and rating constants).
- **Guests**: intensity/nausea/excitement preference, boarding/unloading at stations, nausea, deaths on crash.
- **World**: terrain heights, tunnels, supports collision, scenery within 5 tiles of the station, paths/water proximity for rating bonuses, clearance queries.
- **Economy**: build cost per piece, ride price vs rating, crash penalties.
- **Staff**: mechanics for breakdowns (brake failure is a crash precondition).
- **Rendering**: track mesh from piece sample tables, train poses from `s`, support generation, tunnel portals; no sim dependency on rendering.
- **Tick scheduler**: fixed 40 Hz update; trains only simulated for open/testing rides.

---

## 5. Implementation checklist

MVP
1. Piece type table + connectivity rules (flat, gentle/steep slopes, tiny/small/medium turns).
2. Station, one chain lift, plain brake.
3. Train energy model (2.4), one train, circuit mode.
4. Test run recording max speed, length, drops, vertical/lateral G, airtime.
5. Ratings pipeline (2.7 terms, default coefficients), intensity penalty.
6. Crash-on-crest/drop and train-train collision thresholds.
Next (status: 7 to 9 and 12 are implemented in `src/sim/track` and `src/sim/vehicles`, with the tuning noted in their docs; boosters, shuttle mode and per-type constants are not)
7. Banking and banked turns; lateral G calibration vs table in 2.5.
8. Block brakes/sections, multiple trains, shuttle mode, boosters/launch.
9. Loops, corkscrews, helixes, barrel rolls, twists; inversion count.
10. Tunnels, supports, clearance toggles.
11. Per-ride-type constants, vehicle intensity factors, scenery/proximity bonuses.
12. Stall/rollback detection, failed test statuses.
Fidelity
13. Calibrate against published community numbers (2.5, 2.6); deterministic fixed-point.
14. Rating refinements (synchronized stations, music, ride time limits).

---

## 6. Open questions and sources

Open questions:
- Intensity penalty: ×0.75 or ×0.5 per threshold? (conflict, 2.7)
- Exact airtime, max/avg speed, length, train-length coefficients and thresholds per ride type (public sources lack numbers).
- Exact crash rule scoping (which piece transitions, per-ride-type), and whether RCT1 differs. RCT2 is assumed.
- Original lift/brake speed units and values; booster speeds in RCT2.
- Whether the lateral-G thresholds are 2.8/3.1 (OpenRCT2 wiki) or 2.81/3.11 (rct.wiki display); likely fixed-point rounding.
- Max height / support / tunnel clearance rules.
- Ride-specific height/slope caps and ride-type allowed pieces (need per-ride-type wiki scraping).
- Rating recompute interval and test timeout.

Sources:
- https://github.com/OpenRCT2/OpenRCT2/wiki/Ride-rating-calculation
- https://rct.wiki/wiki/Intensity
- https://rct.wiki/wiki/Excitement
- https://rct.fandom.com/wiki/Crash (search snippet only; page returned 402)
- https://rct.fandom.com/wiki/Car_Ride
- https://github.com/OpenRCT2/OpenRCT2/issues/9642
- https://github.com/OpenRCT2/OpenRCT2/issues/7783
- https://forums.openrct2.org/topic/2831-cheat-idea-override-vehicle-physics/
- https://forums.openrct2.org/topic/2803-guide-how-to-set-your-ride-stats-manually/
- https://forums.openrct2.org/topic/6304-side-friction-cars-maximum-speed/
- https://forums.openrct2.org/topic/4572-impossible-physics/
- https://forums.openrct2.org/topic/6217-split-chainlift-into-multiple-block-sections/
- https://forums.openrct2.org/topic/842-how-are-excitement-intensity-and-nausia-ratings-calculated-exactly/
- https://forums.openrct2.org/topic/6444-understanding-simulation-in-rct2/
- https://forums.openrct2.org/topic/1134-raiselower-track-option/
- https://coasterbuzz.com/Forums/PostLink/480653 , https://coasterbuzz.com/Forums/PostLink/778115
- https://forums.rctgo.com/printthread.php?tid=22646
- https://rctv1.rctspace.com/test/info/tips2.html
- https://tid.rctspace.com/TD4viewer.html
- https://rct.fandom.com/wiki/Inverted_Hairpin_Coaster
