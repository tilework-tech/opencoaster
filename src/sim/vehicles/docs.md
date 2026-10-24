# Noridoc: Vehicles

Path: @/src/sim/vehicles

### Overview

- Advances train-level vehicle state along registered track polylines using fixed-tick integer physics.
- Collects test-run metrics and writes provisional tracked-ride ratings back to the ride store.
- Adapts cached track-system paths into fixed-point vehicle input and retains a small synthetic fixture boundary for isolated simulation tests.

### How it fits into the larger codebase

- [`vehicleSystem`](./vehicle-system.ts) is registered in [`SYSTEM_ORDER`](../core/simulation.ts) and advances the [`World`](../core/world.ts) vehicle store on each simulation tick.
- The vehicle system refreshes `World.vehicleTracks` from [`getTrackPath`](../track/track-path.ts) when a ride's track version changes. The registry is derived runtime state and is not part of the typed-array world state or its save/hash columns.
- [`createVehicleTrackFromPath`](./vehicle-track.ts) maps track piece events/modes, roll orientation, bank, and sampled tangent changes into vehicle segment metadata. Tests can still provide synthetic polylines directly to isolate physics.
- Train state references rides by stable ride ID. On test completion, ratings are written to the ride store only if that ride ID is still alive.
- Vehicle coordinates are available in the world snapshot path for rendering; renderers consume snapshots rather than reading simulation stores directly, as described in [`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md).

### Core Implementation

- [`VEHICLE_SCHEMA`](./vehicle-store.ts) stores one struct-of-arrays row per train. Progress and speed use signed Q8 fixed-point values; the row also holds dispatch and composition fields, physics state, ride-test measurements, and excitement/intensity/nausea ratings. [`spawnTrain`](./vehicle-store.ts) initializes a row and [`getTrainState`](./vehicle-store.ts) exposes a snapshot-shaped read model.
- [`createVehicleTrack`](./vehicle-track.ts) accepts integer XYZ polyline points, per-segment flags, optional signed Q8 lateral and vertical curvature, Q8 bank sine/cosine, inverted-orientation metadata, block-open metadata, and loop/crashability settings. Inversion flags count inversion events; the separate orientation array determines the sign of vertical G while the train is inverted. Bank metadata lets the force calculation adjust lateral G. It validates segment metadata and nonzero segment lengths; loop inputs must end at their starting point. It then precomputes integer segment lengths, cumulative Q8 arclength, block-section starts, and each drop's height from its local preceding crest through the continuous descent. The registry provides stable ride-ID lookup and a tick-ordered track list.
- [`stepVehicles`](./vehicle-system.ts) performs deterministic fixed-tick updates in vehicle-slot order. Acceleration and drag are integrated over the time spent on each segment; when a tick crosses boundaries, it carries remaining tick time forward and processes segment controls and entry events in order. Motion combines slope gravity, inverse-mass rolling friction, speed drag, and controls for chain lift, launch, brakes, and blocks. Final XYZ coordinates are interpolated directly into SoA columns without allocating a temporary tuple.
- Waiting trains dispatch from station segments after the minimum wait and either a full load or the maximum wait. Passenger counts and capacity are inputs to this condition; this area does not load or unload guests.
- A block section admits one train at a time. Adjacent segments marked as blocks share one occupancy reservation. Closed or occupied sections hold an arriving train at the boundary; an open block applies a crawl-speed cap while the train crosses it.
- Collision checks require trains on the same ride to make contact or close the gap within one tick, as well as meeting the combined-speed threshold. For loop tracks, the forward gap is selected from the faster train's direction of travel and wraps across the start/end seam, which is geometrically closed at track creation. Crest and drop-start crash thresholds are separate and apply only when the track is marked crashable; that setting defaults to false. The defaults are 50 and 64 Q8 world-speed units, intended to approximate the spec's 50 and 64 km/h targets; unit conversion and calibration remain open. Test-run stalls can also transition a train to the stalled state.
- Testing trains collect speed, distance, elapsed ticks, drops, drop height, inversions, vertical/lateral force extrema, and airtime. Force extrema sample every segment crossed during a tick, and maximum speed tracks intermediate boundary peaks. Vertical gravity changes sign on segments marked inverted; banked lateral G uses the fixed-point lateral load multiplied by bank cosine and subtracts bank sine. Reaching the end of a non-loop test path completes the run, computes ratings, and writes them to the associated ride.
- [`calculateTrackedRideRatings`](./vehicle-ratings.ts) applies shared force, drop, inversion, and lateral-force threshold terms, plus named original additions for average/max speed, track length, and airtime. Intensity thresholds reduce excitement by the provisional 0.75 factor recorded in [`docs/DECISIONS.md`](../../../docs/DECISIONS.md).

### Things to Know

- The fixed-point and deterministic rules come from the simulation architecture: no wall clock or random source is used in vehicle stepping, and track lengths/curvature metadata are prepared outside the per-tick path.
- Track flags describe simulation events and controls, not editable track pieces. Track editing/loading, ride-mode configuration beyond the stored dispatch fields, and guest loading/unloading are not implemented in this area.
- Real track paths currently expose station, chain-lift, brake, and block-brake controls. Vehicle launch physics is implemented and covered by synthetic-track tests, but the track catalog has no launch mode/piece yet, so placed layouts cannot activate it.
- The path adapter estimates signed curvature from sampled tangents and uses the track path's integer-degree bank samples. Q8 precision and speed/world-unit conversion still need calibration against play data.
- Ratings are provisional. The shared force/drop/inversion terms follow the public-source formulas summarized in [`docs/mechanics/track.md`](../../../docs/mechanics/track.md); speed and airtime additions are original design terms, and length is included as a bounded original term. Ride-type-specific coefficients and calibration against play are not yet available here, so these values should be treated as initial tuning rather than a claim of original-game parity.
- Train and ride rating columns are included in [`hashWorld`](../core/hash.ts)'s live entity-store hashing, so rating writeback is part of determinism comparisons.
- G-force values and speed metrics use integer fixed-point storage, and ride ratings are stored as integers. Curvature-based acceleration is divided by the model gravity and converted to Q8 G before it contributes to the ride-test force extrema. Consumers should use the schema/API rather than infer floating-point units from field names.
- Synthetic polyline tests establish deterministic vehicle behavior independently of track construction. The vehicle system is inert when `World.vehicleTracks` is absent.

Created and maintained by Nori.
