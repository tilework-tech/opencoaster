# Engine: world, clock, rendering, and presentation

## 1. Overview and player feel

OpenCoaster should feel continuously alive while its rules remain legible: guests choose paths and react to needs, rides advance independently, the calendar and park finances move at a steady pace, and the player can pause, inspect, build, and rotate the park without those actions changing simulation results unpredictably. The game world is a grid, but each grid cell can hold several layers of terrain, paths, track, scenery, and other elements. The camera shows that layered world as a 2D isometric scene from four quarter-turn orientations.

Separate simulation time from drawing time. A fixed 25 ms simulation step gives repeatable decisions and stable game speed; rendering can run at the display refresh rate and interpolate between authoritative simulation states. This keeps input and windows responsive while a Web Worker runs the park simulation. These are OpenCoaster design choices, not claims about the original implementation.

Confidence labels used below:

- **Verified (multiple sources):** supported by more than one independent public description or by the original manual plus a technical description.
- **Verified (single source):** supported by one public source. Technical wiki pages may describe OpenRCT2's understanding of the classic format, rather than an independently documented original implementation.
- **Inferred / proposed:** an OpenCoaster design recommendation or a conclusion not directly established by historical sources.
- **Open:** public behavior descriptions reviewed here do not settle the detail.

## 2. Precise rules and historical behavior

### World grid and tile-element stacks

- **Verified (single source):** Each map coordinate can contain multiple tile elements. The public map description says elements are contiguous and normally ordered by base height; the last element carries a marker for the end of the stack. Described element classes include surface, path, track, small scenery, entrance, wall, large scenery, and banner. [OpenRCT2 Maps technical wiki](https://github-wiki-see.page/m/OpenRCT2/OpenRCT2/wiki/Maps)
- **Verified (single source):** The legacy map description uses an 8-byte tile-element record. Shared fields include type/rotation, flags, base height, and clearance height; the rest depends on the element type. Encoded base/clearance values convert to the description's “real units” by multiplying by 8. Treat this as a description of the classic-compatible map representation, not a requirement for OpenCoaster's in-memory encoding. [OpenRCT2 Maps technical wiki](https://github-wiki-see.page/m/OpenRCT2/OpenRCT2/wiki/Maps)
- **Verified (single source):** RCT2 height labels describe one elevation block as 5 feet / 1.5 metres, or one displayed unit when Units is selected. Don't confuse this player-facing elevation block with the raw stored height field. [RCT2 manual, options and height labels](https://www.andrewsteele.me.uk/technology/game_manuals/rollercoaster_tycoon_ii.pdf)
- **Verified (single source):** The vanilla-compatible RCT2 save/scenario limits document a 254 × 254 playable map, excluding an invisible outer ring. The same list gives 196,096 map elements and 10,000 sprites. These are legacy-format ceilings, not sensible modern OpenCoaster caps. [OpenRCT2 game-limits wiki](https://github-wiki-see.page/m/openrct2/openrct2/wiki/Increasing-of-game-limits)
- **Verified (single source, weaker):** RCT1 is commonly described as a 128 × 128 allocated map with 126 × 126 interior/playable tiles. The evidence found is community/technical discussion, not an original manual, so preserve the 126/128 distinction and treat the exact usable boundary as lower confidence. [Map-size discussion](https://www.reddit.com/r/openrct2/comments/t51w1w/map_size/)
- **Verified (single source):** The RCT2 technical geometry note models the camera as rotated 45° and pitched down 30°. It derives a theoretical unit height of `tan(30°) * sqrt(2) / 2 ≈ 0.4082` tile widths, but also says classic RCT sprite alignment was not mathematically exact and its precise value is unknown. Do not use 0.4082 as a pixel-perfect original constant. [Sizes and angles in the game world](https://github-wiki-see.page/m/OpenRCT2/OpenRCT2/wiki/Sizes-and-angles-in-the-game-world)

### Simulation clock and update ordering

- **Verified (multiple public descriptions):** Normal logic time is 40 ticks/second, or one tick every 25 ms. The RCT2 manual describes game speed controls; a public technical overview explicitly gives the 25 ms tick interval, and an OpenRCT2 developer forum discussion distinguishes the 40 Hz game from extra render frames. Use 40 Hz as the RCT2-era target. [Overall program structure](https://github-wiki-see.page/m/OpenRCT2/OpenRCT2/wiki/Overall-program-structure), [developer discussion of 40 ticks and extra render frames](https://forums.openrct2.org/topic/2710-consistent-server-stability-found-less-desyncs-dev-builds-012/)
- **Verified (single source; RCT2/OpenRCT2 calendar description):** One in-game month spans 16,384 ticks, which at 40 Hz is 409.6 seconds (6 min 49.6 sec); the game year has eight months, March through October. Treat the month length as an integer tick counter, not a real-world calendar. [Date and Time technical wiki](https://github-wiki-see.page/m/Sadret/openrct2-plugin-wiki/wiki/Date-and-Time)
- **Verified (single source):** The public OpenRCT2 frame-loop description says a variable/render frame processes input, consumes zero or more accumulated 25 ms logic ticks, then updates windows and draws; interpolation may be applied between ticks. If a frame falls behind, more than one fixed update can run before the next draw. This is useful evidence for the separation between logic and presentation, but it does not establish the original binary's complete internal phase order. [Overall program structure](https://github-wiki-see.page/m/OpenRCT2/OpenRCT2/wiki/Overall-program-structure)
- **Open historical question:** Public behavior descriptions reviewed here do not verify the original RCT1/RCT2's full subsystem order or an exact, general entity-stagger schedule. Do not present a copied OpenRCT2 implementation sequence as original-game fact. The 40 Hz rule is better supported than any detailed tick ordering.
- **Inferred / proposed OpenCoaster order:** At each fixed tick boundary: (1) apply player commands queued for that tick in stable sequence order; (2) advance game clock and due calendar events; (3) apply world edits and update ride vehicles; (4) move guests/staff and resolve local movement/collision; (5) process due guest decisions and staff tasks; (6) process scheduled ride, economy, research, rating, and scenario rules; (7) publish events and a compact render snapshot. Persist this order in code and add deterministic replay checks before adding multiplayer.
- **Open historical question:** A universal claim that all original guests, staff, rides, and scenery each update every tick—or that they update on a particular stagger—is not established by the public behavior sources. Avoid falsifying fidelity with a made-up historical constant.

### Entity update scheduling proposal

- **Inferred / proposed:** Keep movement, ride-vehicle advancement, queue transitions, and urgent state changes on every 25 ms tick. Schedule expensive guest intent/path re-evaluation in deterministic cohorts, initially every 4 ticks (10 Hz) per guest: `if (((guestId + tick) & 3) === 0) reconsiderIntent(guestId)`. A blocked guest, changed target, ride closure, or newly invalid path can force an immediate reconsideration. These values are OpenCoaster tuning parameters, not RCT constants.
- **Inferred / proposed:** Stagger nonurgent area scans and housekeeping over 16- or 64-tick windows; make calendar/economy changes event-driven from the game clock. Keep exact random streams per entity or subsystem and consume random values only in stable entity order so cohort scheduling stays reproducible.
- **Inferred / proposed:** Renderer animation is presentation-only. Interpolate previous/current positions using elapsed time since the last simulation tick; never advance guest intent, collision, money, or ride state from `requestAnimationFrame`.
- **Inferred / proposed:** Keep a small explicit guest state machine (`walking → queueing → riding → leaving`) and apply transitions only at tick boundaries. Queue entry, dispatch, ride exit, and park exit are subsystem events; the engine should not encode their gameplay probabilities as global constants. Use seeded, persisted random streams at the subsystem decision points that need chance, and make replays consume those streams in stable order. No universal original-game probability or engine-wide state machine was established by the public sources reviewed.

### Isometric projection, painter ordering, and viewport

- **Verified (multiple sources):** RCT2 provides zoom in/out and 90° clockwise rotate controls. Four camera orientations result from four quarter-turn rotations. The manual describes zoom as trading visible area against detail. [RCT2 manual](https://www.andrewsteele.me.uk/technology/game_manuals/rollercoaster_tycoon_ii.pdf), [main interface guide](https://docs.openrct2.io/en/latest/playing/main_interface/)
- **Verified (single source):** The RCT2 interface separates the park viewport from fixed toolbars and floating windows; the Mini-Map represents the whole park and can recenter the main view. [RCT2 manual](https://www.andrewsteele.me.uk/technology/game_manuals/rollercoaster_tycoon_ii.pdf)
- **Verified (single source):** OpenRCT2's later renderer/docs include additional close zoom/scaling options. Do not treat those modern additions as evidence of the vanilla zoom ladder. The exact original zoom scale multipliers were not independently established by the manual descriptions reviewed here. [OpenRCT2 changes from original](https://github-wiki-see.page/m/openrct2/openrct2/wiki/Changes-to-original), [OpenRCT2 options](https://docs.openrct2.io/en/latest/setup/options.html)
- **Verified (single source):** Isometric scenes need back-to-front painting so nearer opaque pixels cover farther objects. The 45°/30° geometry above is a useful projection model, but sprites and large scenery can overlap several tiles; a single `(x + y)` key is not guaranteed to order every overlapping pair correctly. [Sizes and angles technical wiki](https://github-wiki-see.page/m/OpenRCT2/OpenRCT2/wiki/Sizes-and-angles-in-the-game-world)
- **Inferred / proposed:** Rotate integer map coordinates into view coordinates for the four camera states, then project the ground anchor. Use stable painter ordering over visible terrain elements and entity anchors. Compute projected depth intervals from each footprint and elevation; order non-overlapping intervals back-to-front, then use element-stack order, coarse render layer, and stable entity ID as tie-breakers. When tall objects overlap another object in ways that produce contradictory pairwise order, subdivide their draw spans into screen-space column/region buckets or use authored occlusion masks, then topologically order each bucket. This is a proposed algorithm, not a verified RCT comparator. Do not batch across an order boundary if that changes the visible result.
- **Inferred / proposed:** Start with four discrete orientations and four classic-style zoom steps (one step changes scale by 2× as a design assumption). Add continuous CSS/device-pixel scaling separately. Use a camera viewport with pan, center-on-entity, minimap recentering, underground/filter overlays, and zoom-to-cursor. The zoom count is a compatibility choice, not a verified historical fact.

### UI windows inventory (RCT2 target)

- **Verified (multiple sources):** Main toolbar groups cover pause/fast-forward and save/options; view controls (zoom, rotate, visibility/underground, map); build tools (clear, land, water, scenery, paths, rides); and park management (finances, research, rides list, park information, staff, guest list). The toolbar docs note some extra buttons can be enabled in options. [Main interface guide](https://docs.openrct2.io/en/latest/playing/main_interface/), [RCT2 manual](https://www.andrewsteele.me.uk/technology/game_manuals/rollercoaster_tycoon_ii.pdf)
- **Verified (single source):** Core windows to plan for: Park Information/objective/admission; Finances; Research & Development; Rides/Attractions list; individual ride details and construction; Staff list and staff details/patrol; Guest list and guest details; Mini-Map; land/water/scenery/path construction pickers; scenario/editor tools; messages; options; and save/load dialogs. Individual ride tabs expose operating settings and statistics; guest details expose needs/thoughts and allow following the guest. [RCT2 manual](https://www.andrewsteele.me.uk/technology/game_manuals/rollercoaster_tycoon_ii.pdf)
- **Verified (single source):** RCT1's research UI has a separately presented ride-improvements category; RCT2 groups discoveries differently in the RCT2-era interface. Mark exact category behavior as version-specific and verify against the selected scenario/rules, not a shared UI assumption. [RCT1/RCT2 research comparison discussion](https://forums.openrct2.org/topic/5206-ride-improvement-research/)
- **Inferred / proposed:** Implement window shells with independent state and one shared viewport model; opening an inspector should not pause simulation. Keep simulation commands separate from window UI state.

### Save and scenario concepts

- **Verified (single source):** Classic RCT2 uses `.SV6` saved games and `.SC6` scenarios; a specialist format description presents them as chunked data, with different chunk inventories for park saves and scenarios and high-level sections such as map, game data, available objects, flags, and scenario metadata. [RCTTechDepot SV6/SC6 notes](https://freerct.github.io/RCTTechDepot-Archive/SV6.html)
- **Verified (single source):** RCT1's corresponding legacy extensions are `.SV4` and `.SC4`. OpenRCT2 can import these older formats; its later `.park` format replaces RCT2 SV6/SC6 for OpenRCT2 saves and is not vanilla-compatible. [OpenRCT2 limits wiki](https://github-wiki-see.page/m/openrct2/openrct2/wiki/Increasing-of-game-limits), [OpenRCT2 man page](https://manpages.debian.org/unstable/openrct2/openrct2.6.en.html)
- **Inferred / proposed:** Save a versioned OpenCoaster schema, not a compatible clone of any legacy binary: metadata and schema version; dimensions and tile stacks; ride/track graphs; entity arrays; economy and calendar; scenario objective/rules; object catalog identifiers; and deterministic RNG state. Store scenarios as authored starting state plus objective/catalog constraints, while saves include the live park state. Use named sections with lengths and checksums so a browser can load incrementally and migrate versions. Use IndexedDB for browser persistence; compression and import/export can be layered on after the schema is stable.
- **Clean-room rule:** Do not copy legacy binary layouts, file parsers, original graphics, sounds, names, or source implementation into this format or repository. The links above are behavioral/format references only.

## 3. Data model proposal and CPU budget

Use struct-of-arrays for high-count entities and tile elements so hot loops read compact typed data without allocating one JavaScript object per guest. Keep semantic enums in documentation and encode them into integer arrays in runtime code.

```ts
type EntityId = number;       // packed slot plus generation handle
type Tick = number;            // monotonically increasing integer
type SimCommand = {
  tick: Tick; sequence: number; kind: string; payload: Uint8Array;
};

type TileMap = {
  width: number;
  height: number;
  // CSR-style stacks: elements for tile i are [tileStart[i], tileStart[i + 1])
  tileStart: Uint32Array;      // width*height + 1
  elementType: Uint8Array;
  elementRotation: Uint8Array;
  baseHeight: Uint16Array;     // OpenCoaster world units; do not copy legacy encoding
  clearanceHeight: Uint16Array;
  elementFlags: Uint16Array;
  elementObjectId: Uint32Array;
  elementDataIndex: Uint32Array;
};

type GuestSoA = {
  active: Uint8Array;
  generation: Uint32Array;
  x: Int32Array; y: Int32Array; z: Int16Array; // fixed-point world coordinates
  prevX: Int32Array; prevY: Int32Array; prevZ: Int16Array;
  heading: Uint8Array; state: Uint8Array; needs: Uint8Array;
  // Proposed states include walking, queueing, riding, and leaving.
  targetTile: Int32Array; rideId: Int32Array; queueId: Int32Array;
  nextDecisionTick: Uint32Array; rngState: Uint32Array;
};

type RideSoA = {
  active: Uint8Array;
  status: Uint8Array;
  stationStart: Uint32Array; stationCount: Uint8Array;
  vehicleStart: Uint32Array; vehicleCount: Uint16Array;
  priceCents: Int32Array; reliability: Uint8Array;
};

type SimState = {
  tick: Tick;
  randomSeed: number;
  map: TileMap;
  guests: GuestSoA;
  rides: RideSoA;
  dirtyTileBits: Uint8Array;
  commandQueue: SimCommand[];
};
```

`baseHeight` units and fixed-point precision are OpenCoaster choices. Tile stacks should remain contiguous but may be rebuilt by chunk after edits. Make capacity growth explicit; avoid per-tick array resizing. A Web Worker owns authoritative state and accepts tick-stamped commands. Send only changed render fields/entity IDs to the main thread, using transferable buffers or a double-buffered SharedArrayBuffer where deployment headers permit it. [Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API) and [transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects) provide the browser primitives; [OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas) is an optional path for worker-side rendering. The main thread owns input, windows, and accessibility UI. WebGL2 draws instanced quads from the generated world-art atlas, with a procedural fallback for missing sprites; [instanced drawing](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/drawElementsInstanced) is the API mechanism. Include no RCT assets. Keep painter order by emitting batches in sorted order, merging only adjacent atlas/material groups.

Spatial hashing proposal: bucket guests/staff by coarse world cell (for example 4×4 tiles); update bucket membership only when an entity crosses a bucket boundary. Use it for crowd/local collision and staff-nearby queries, not long-range pathfinding. Pathfinding should use path connectivity and cache invalidation keyed by changed path tiles.

### Initial measurable performance budget (proposed, not measured)

Target baseline: current desktop Chrome/Firefox on a four-core, midrange laptop, 1920×1080 viewport, 5,000 active guests, 250 staff, 250 rides, and a 254×254 map with 10,000 placed elements. A 40 Hz tick has 25 ms available. Budget **≤8 ms mean simulation CPU per tick and ≤12 ms at p95** so bursts leave headroom; render independently at 60 Hz with **≤8 ms p95 CPU/GPU submission+draw time**. Profile on lower-end mobile before claiming mobile support.

| Work per simulation tick | Budget |
|---|---:|
| Guest movement, needs, scheduled decisions (5,000 guests) | 4.0 ms |
| Staff and ride vehicles | 1.0 ms |
| Path queries and local spatial interactions | 1.5 ms |
| Economy, calendar, ratings, research (amortized) | 0.75 ms |
| Commands, events, render delta/snapshot | 0.75 ms |
| **Total target** | **8.0 ms mean** |

At 5,000 guests, that sets a 0.8 ms/1,000-guest aggregate allowance for the guest line, or 0.8 µs/guest/tick on average. That is a profiling target, not a proven JavaScript cost. Enforce: zero full-map scans each tick; no per-guest object allocation in hot loops; dirty-tile/chunk invalidation; visible-viewport culling; bounded path searches; stable typed-array iteration; and deterministic command/RNG order. Track ticks/sec, mean/p95 tick cost, catch-up tick count, visible sprite count, dirty chunks, and worker-message bytes in a debug HUD.

Rendering proposal: cache static map chunks in GPU textures/FBOs and redraw only changed chunks plus their projected overlap bounds; moving entities and overlays redraw each frame. Dirty regions are an optimization, not a way to omit objects whose tall sprites overlap a modified region. Use a 32×32 tile chunk as an initial cache unit and benchmark it. Culling should be by camera-visible world bounds plus a margin based on maximum sprite extent.

## 4. Dependencies on other subsystems

- **Guests:** own position, movement animation, needs, current intention, target ride/shop, queue membership, and deterministic decision scheduling. Need navigation connectivity and ride/price/status queries.
- **Rides and track:** vehicle progression and station/queue transitions run on the fixed clock; rendering consumes ride pose/sprite IDs, while ratings and breakdown/maintenance rules feed park management.
- **Economy and scenario:** calendar events drive wages, operating costs, loan interest, research funding, objective checks, and periodic summaries. UI windows observe state; they do not own it.
- **Staff/world:** mechanics and handymen query rides or nearby dirty/broken regions through spatial/path indexes; terrain/path edits invalidate navigation, tile caches, and affected ride/world queries.
- **Rendering:** reads immutable snapshots/deltas, maps element and entity IDs to generated atlas entries (using fallback cells for missing sprites), applies four view rotations and zoom, handles painter order and interpolation, and draws UI windows separately from the park viewport.
- **Persistence:** serializes authoritative simulation state and schema version, not GPU buffers, window positions as game state, or derived spatial hashes. Rebuild caches and indexes after load.

## 5. Prioritized implementation checklist

### MVP

1. Define fixed-point world coordinates, tile dimensions, a variable-length tile-stack map, and a small initial map. Keep map limits configurable; do not bake vanilla RCT2's 254 limit into core arrays.
2. Implement a deterministic 40 Hz worker clock with tick-stamped commands, pause/speed controls, per-tick RNG, and replayable state hashes.
3. Add simple guests and staff in typed arrays; move them on a path graph each tick and schedule expensive intent decisions in deterministic cohorts, with urgent invalidation paths.
4. Implement one camera viewport with four 90° rotations, discrete zoom, pan, culling, and a minimap.
5. Render newly generated tile art and world sprites from an atlas with WebGL2 instanced quads and stable painter order. Add an overlap test scene for tall scenery, bridges, guests, and rides.
6. Add 32×32 dirty map chunks and measure cache invalidation correctness when an edit overlaps tall sprites or neighboring chunks.
7. Implement the first windows: park/objective, rides list/detail, guest detail, staff, finances, research, map, build tools, options, save/load, and recent messages.
8. Persist and restore a versioned park plus scenario definition in IndexedDB; validate that loading reproduces the same deterministic state hash.

### Fidelity and scale

9. Add calendar scheduling, monthly accounting, research unlocks, ride operating modes, guest needs, queue behavior, staff tasks, rating/objective rules, and version-specific RCT1/RCT2 differences.
10. Compare classic zoom projection, slope/height alignment, occlusion, and camera controls against public manuals/screenshots created from clean-room art; tune a documented projection profile without importing original assets.
11. Expand browser benchmarks to 2k, 5k, and 10k guests at 40 ticks/sec, then profile high-occupancy/pathfinding and dirty-region worst cases. Require the budget above at the named baseline before adding more fidelity.
12. Add import/export and schema migrations only for OpenCoaster's own documented format. Do not promise SV6/SC6 compatibility.
13. Validate usability and performance at high zoom-out, high zoom-in, all four rotations, windows covering portions of the viewport, tab backgrounding, and catch-up after temporary stalls.

## 6. Open questions and sources

### Open questions

- What exact calendar/day event schedule should OpenCoaster use for vanilla RCT2 feel? Public sources support the 16,384-tick month, but RCT1 timing details are less consistently sourced.
- Which original entity tasks were truly every-tick versus staggered? Do not infer from current OpenRCT2 implementation internals; verify later through published behavior descriptions or controlled gameplay observation.
- What exact classic zoom scale ratios and number of visible steps should the MVP reproduce? The manual documents zoom controls, not exact ratios.
- What painter ordering handles the full set of tile-stack, tall-scenery, track, vehicle, and guest overlap cases? The cited geometry note warns classic sprite alignment is not mathematically exact.
- Should OpenCoaster eventually support maps larger than 254 × 254? Choose data structures that permit growth, then set product limits from profiling.
- Which RCT1-versus-RCT2 management differences belong in the initial compatibility target (research categories, finance rules, UI, and scenario format)?

### Sources

1. [RCT2 manual (PDF)](https://www.andrewsteele.me.uk/technology/game_manuals/rollercoaster_tycoon_ii.pdf) — height labels, toolbar, view controls, windows, and scenario/editor descriptions.
2. [OpenRCT2 main interface guide](https://docs.openrct2.io/en/latest/playing/main_interface/) — toolbar groups, park viewport, pause/speed, view/build/management actions.
3. [OpenRCT2 Maps technical wiki](https://github-wiki-see.page/m/OpenRCT2/OpenRCT2/wiki/Maps) — tile element stacks, record fields, element kinds, height encoding.
4. [OpenRCT2 game-limits wiki](https://github-wiki-see.page/m/openrct2/openrct2/wiki/Increasing-of-game-limits) — legacy vanilla RCT2 map/entity/object limits and later save-format distinction.
5. [Sizes and angles in the game world](https://github-wiki-see.page/m/OpenRCT2/OpenRCT2/wiki/Sizes-and-angles-in-the-game-world) — isometric camera geometry and warning about classic sprite alignment.
6. [Overall program structure](https://github-wiki-see.page/m/OpenRCT2/OpenRCT2/wiki/Overall-program-structure) — public description of the 25 ms update clock, catch-up updates, interpolation, UI update, and draw phases.
7. [OpenRCT2 developer discussion of 40 ticks/sec](https://forums.openrct2.org/topic/2710-consistent-server-stability-found-less-desyncs-dev-builds-012/) — separates logic ticks from extra draw frames.
8. [Date and Time technical wiki](https://github-wiki-see.page/m/Sadret/openrct2-plugin-wiki/wiki/Date-and-Time) — tick-to-calendar conversion.
9. [RCTTechDepot SV6/SC6 format notes](https://freerct.github.io/RCTTechDepot-Archive/SV6.html) — high-level legacy save/scenario chunk concepts; archival reverse-engineered documentation.
10. [OpenRCT2 changes from original](https://github-wiki-see.page/m/openrct2/openrct2/wiki/Changes-to-original) — distinctions between vanilla-era behavior and later OpenRCT2 additions.
11. [Map-size discussion](https://www.reddit.com/r/openrct2/comments/t51w1w/map_size/) — lower-confidence RCT1 map allocation/usability figures.
12. [RCT1/RCT2 research comparison](https://forums.openrct2.org/topic/5206-ride-improvement-research/) — single-source discussion of version-specific research UI categories.
13. [OpenRCT2 options documentation](https://docs.openrct2.io/en/latest/setup/options.html) — current renderer/scaling behavior; not a vanilla zoom specification.
14. [MDN Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API) — worker execution model for browser-side simulation.
15. [MDN transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects) — transferring typed-array backing buffers between threads.
16. [MDN OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas) — optional worker-side rendering primitive.
17. [MDN WebGL2 instanced drawing](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/drawElementsInstanced) — indexed instanced draw API.
