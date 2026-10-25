# World mechanics: staff, litter, weather, land, paths, scenery

Status: research spec draft. Written from web sources that were partly unreachable (several fan-wiki pages returned HTTP 402 to automated fetching). Most numeric values below are single-source or unverified. Each rule carries a confidence tag:

- [M] verified from multiple independent sources
- [S] single source (named in the Sources section)
- [I] inferred or design proposal, not observed in any source

Where RCT1 and RCT2 differ, RCT2 is preferred and the difference is noted. Nothing here is copied from original RCT assets or OpenRCT2 source code. Behaviour is described in our own words.

---

## 1. Overview and feel

The world layer is what makes a park look alive and degrade when neglected. Guests walk paths, drop litter and sometimes vomit. Staff clean, water, mow and repair. Weather changes what guests want to do. The player shapes the land, paths and scenery that guests judge their experience by.

Player-facing feel:
- A clean park with varied scenery produces happy guests who compliment the park [S].
- Neglect cascades: litter lowers happiness, unhappy guests vandalise bins, benches and lamps, and vandalism lowers park rating [S].
- Weather is a soft constraint, not a hard stop. Rain changes which food sells and whether guests join uncovered queues [S].
- Staff are a recurring cost that the player balances against cleanliness [S].

These are source observations about the reference games. Current OpenCoaster behavior is summarized separately in §7; it is intentionally narrower.

---

## 2. Precise rules

### 2.1 Staff types

| Type | Role | Wage (RCT2) | Confidence |
|---|---|---|---|
| Handyman (janitor) | Sweep paths, empty bins, clean litter and vomit, water and mow | $50/month. RCT1: $35/month | [S] |
| Mechanic | Inspect and repair rides. Can be set to inspect only, repair only, or mixed | $80/month | [S] |
| Security guard | Deters vandalism near its patrol area | $60/month | [S] |
| Entertainer | Walks the queue ("works the line") and raises nearby guest happiness | $55/month | [S] |

Staff AI and patrol:
- A staff member with no patrol area wanders the park and does any job it bumps into [S].
- Handymen with a patrol area stay within it. Advice is about 5 to 6 tiles per handyman, including gardens and lawns [S, community rule of thumb].
- Mechanics are assigned to rides, not areas. Cover at least the ride exit. A mechanic can walk back and forth without repairing if placed poorly [S].
- Handymen can climb roof paths in their patrol area and get stuck. Keep roof paths off their patrol area [S].
- Community rule of thumb: 4 to 6 handymen and 6 to 8 mechanics later in a park, at least two of each early on [S, forum opinion, not a game rule].

Cost: the player manual lists salaries of $50/month for handymen, $80/month for mechanics, $60/month for security, and $55/month for entertainers. OpenCoaster charges each monthly salary at the month boundary; the rates and cadence are recorded in [DECISIONS.md](../DECISIONS.md). Park inputs refresh from the staff roster every 128 ticks, while hire and fire actions also adjust the wage input immediately.

### 2.2 Litter and vomit

- In the reference games, guests generate litter and vomit; the precise trigger and representation are not established here [S/I].
- OpenCoaster generates vomit for sufficiently nauseous guests and may generate trash for other guests. Litter entities do not age out; handymen can remove them, and the entity store is bounded. See §7.
- Guests lose happiness when they walk past trash or vomit. Stepping on many vomit tiles produces a specific negative thought [S].
- Clean paths produce a positive guest thought [S].
- Exact per-tile penalties, decay rates and tick timings are not established by the references collected here. OpenCoaster's values are implementation tuning rather than claims about RCT2.

### 2.3 Bins, benches, lamps

- In the reference games, bins, benches and lamps are path items. Vandals can destroy them and they must be repaired by the player [S].
- Vandalised bins, benches and lamps lower park rating when guests comment on them [S].
- Bins sit on path tiles and hold litter. Bin emptying is a handyman task [S].
- OpenCoaster supports path bin and bench additions. Bin capacity and emptying behavior are implementation details summarized in §7. Vandalism marks path additions as broken in map state; visual condition and a dedicated repair control are not yet implemented.

### 2.4 Vandalism

- Vandals are guests whose happiness is very low, mainly because of excess litter and vomit [S].
- The vandal rate is tied to litter and vomit density in a path area [S].
- Vandals also destroy nearby benches, lamps and bins regardless of their own happiness [S].
- Security guards are described as deterring vandalism near their patrol area [S]. OpenCoaster currently gates attempts on recent litter/vomit memory and guard proximity; stopped/attempt counters remain absent. Memory and anger durations are provisional implementation assumptions, not sourced RCT2 timings.
- Thresholds and probabilities are not found [unverified].

### 2.5 Weather

Weather states and transitions are not fully described in the sources reached.

Reference-game effects reported by the collected sources:
- Rain: ice cream does not sell when it is cold or raining. Cotton candy does not sell in rain but does sell when cold [S].
- Rain and queues: guests refuse to join uncovered queues in rain. Guests already in an uncovered queue stay [S].
- Rain and rides: uncovered rides are described as very unpopular in rain [S, forum anecdote].
- Umbrellas: information kiosks sell umbrellas that keep guests dry in rain [S].

The exact state list, transition rules, durations, probabilities, and numerical ride effects remain unknown for the reference game. OpenCoaster's current weather effects and tuning are described in §7.

RCT3 is not a reference for this. A forum thread on RCT3 rides and rain says guests still ride at the minimum rate in rain [S, RCT3 only, do not apply to RCT2].

### 2.6 Land and terrain

- The player can raise and lower land, add water, and set surface types. Scenery and rides can sit above and below ground [S, Wikipedia summary of RCT2].
- Land ownership and construction rights are in the game, but the exact rules were not found in any source reached [unverified].
- Underground track counts toward cover for indoor status. A community guide says at least 40% of a tracked ride's track must be underground to count as indoor [S, fan guide, unverified].

### 2.7 Footpaths and queue rules

- Guests walk paths. Path quality is affected by litter and vomit [S].
- Queue paths: queues need cover to be joined in rain [S].
- Staff walk paths in their patrol area. Roof paths are a known trap for staff [S].
- Path width, queue lane rules and pathfinding costs are not found [unverified].

### 2.8 Scenery and guest happiness

- Scenery raises happiness. A park with a lot of scenery gets compliments from guests. The "great scenery" thought is listed as RCT2-only [S].
- Jumping fountains on paths earn compliments [S].
- One forum user says scenery has little effect in their parks, with no figures [S, anecdote, conflicts with the above].
- Scenery value and happiness weights are not found [unverified].

### 2.9 Parameters that need primary sources

These are not in any source reached. Do not guess them. Each needs a primary source or a measurement against the original game:

- Simulation tick rate. Our target is 40 ticks per second. Source for the original game's rate is not confirmed [unverified].
- Happiness scale. A community source says 0 to 255 [S].
- Litter and vomit decay, spawn rates, and per-tile happiness penalties.
- Staff speed, patrol radius per staff type, and task durations.
- Weather state durations and transition probabilities.
- Vandal spawn threshold and probability.
- Repair costs and breakdown probabilities.

---

## 3. Data model proposal

This section records an early design proposal, not the current TypeScript layout. Current state is distributed across [World](../../src/sim/core/world.ts), entity stores, and tile-element stacks; see the module Noridocs for implementation details.

Use struct-of-arrays for anything with many instances. Tiles are the big array; staff and vandals are smaller arrays.

```ts
// Tile grid: one entry per map tile. Typed arrays, indexed by y * width + x.
interface TileGrid {
  width: number;
  height: number;
  height0: Uint8Array;        // base land height, 0..255
  surface: Uint8Array;        // surface enum: grass, path, water, etc.
  pathLitter: Uint8Array;     // litter count on the path tile, 0..N (N TBD)
  pathVomit: Uint8Array;      // vomit count, 0..N (N TBD)
  owner: Uint8Array;          // land ownership flags, 0 = unowned
  scenery: Uint16Array;       // scenery object id, 0 = none
  pathItem: Uint8Array;       // bin, bench, lamp, none
  pathItemCondition: Uint8Array; // 0..255, 0 = vandalised
}

// Staff: small set, struct-of-arrays.
interface StaffPool {
  count: number;
  type: Uint8Array;           // handyman, mechanic, guard, entertainer
  x: Float32Array;
  y: Float32Array;
  patrolId: Uint16Array;      // index into patrol area table
  task: Uint8Array;           // current task enum
  taskTimer: Uint16Array;     // ticks remaining on current task
  wageCents: Uint32Array;     // proposed monthly cost; not the current wage representation
}

// Patrol areas: a set of tiles per staff group.
interface PatrolArea {
  tileIndices: Uint32Array;   // flat list of tile indices
  staffCount: number;
}

// Weather: single global state, cheap.
interface Weather {
  state: number;              // enum, TBD
  ticksRemaining: number;
  temperature: number;        // scalar, TBD
}
```

Per-tick CPU budget:
- Litter and vomit update: walk only tiles marked dirty, not the full grid [I].
- Staff update: linear in staff count, which should be hundreds at most [I].
- Weather: O(1) per tick [I].
- Rough budget at 40 ticks/second: world layer under 2 ms per tick in a browser tab for thousands of guests, leaving headroom for guests and rides [I, to measure].

---

## 4. Dependencies

- Guests: happiness, thoughts, vandalism trigger, queue behaviour in rain, food and drink sales in weather [S].
- Rides: breakdown and repair (mechanics), vomit source, uncovered queues in rain, indoor status via underground track [S].
- Track: track height and underground status for indoor rules [S].
- Economy: staff wages, bin and bench repair costs, park rating [S].
- Staff/world: patrol areas and task assignment. This spec owns those rules.
- Rendering: litter, vomit, weather visuals, and path item states [I].

---

## 5. Prioritised implementation checklist

This was an initial target list and is not a statement that the items remain unimplemented. Current behavior and tuning are summarized below; source observations above remain distinct from game-specific implementation choices.

MVP:
1. Tile map with terrain, ownership, paths and path additions.
2. Staff hire/fire commands, role-based monthly wages, patrol masks, handyman litter/bin tasks, mechanic inspections, and entertainer happiness effect.
3. Guest trash/vomit generation and litter cleanup; current rates and lifetime are OpenCoaster tuning.
4. Seeded weather transitions, rain/storm ride scoring, and kiosk umbrella purchases.
5. Save migration for staff patrol masks, umbrella ownership, and wage reconstruction.

Still outside the current implementation:
1. Scenery targeting and witness thoughts; lamp vandalism and a dedicated repair control. Bench/bin broken state, nearby security deterrence, and stopped-vandal statistics are implemented.
2. Full rain and covered-queue behavior, weather-specific stall behavior, and weather visuals. Scenario climate and monthly base temperatures are implemented; nine-state weather and climate transition probabilities remain deferred.
3. Scenery catalog, placement, fountain/music effects and scenery removal charges; generic scenery/very-clean guest thoughts are implemented. Scenario-configured land prices and related controls remain deferred.
4. Reference-game numerical calibration for staff rates, weather and litter behavior.

---

## 6. Open questions

1. What are the exact litter and vomit spawn rates, decay rates and happiness penalties?
2. What are the weather states, durations and transition probabilities?
3. How does rain change happiness and ride popularity numerically?
4. Does the original game charge the manual-listed monthly staff salaries at a monthly boundary or split the amount across weekly charges?
5. What are the vandal spawn threshold and probability?
6. What is the original simulation tick rate, and is 40 ticks/s a faithful target?
7. How does land ownership and construction rights work?
8. How are scenery happiness weights computed?
9. Do community staff-count rules of thumb match the game's real behaviour?
10. Is the 40% underground rule for indoor status verified?

## 7. Current OpenCoaster implementation notes

These are verified code behaviors, not claims about the referenced games. Rates and thresholds are implementation tuning unless a source-backed value is explicitly identified above.

- Staff hire/fire actions update a per-role monthly wage input, which [park inputs](../../src/sim/economy/park-inputs.ts) republishes from the roster every 128 ticks. Staff are charged the manual-listed $50/$80/$60/$55 monthly role rates at the month boundary; this cadence is an implementation decision pending original-game validation. Older saves rebuild wages from staff kinds. Patrol masks are per staff role; mechanics inspect due or broken rides, handymen clean nearby litter and empty unbroken bins, entertainers periodically raise happiness nearby, and security guards deter nearby break attempts. Handyman watering/mowing and staff firing UI are not implemented. See [staff Noridoc](../../src/sim/staff/docs.md).
- Guests periodically generate trash or vomit on walkable tiles. Every 160 ticks, sufficiently nauseous guests can vomit, lowering nausea and halving hunger after a successful drop; other guests make a one-in-48 trash roll. A bin stores four 2-bit corner counters in its path element's `elData` byte, initialized to `0xff`. Each trash deposit independently decrements every corner counter with remaining capacity at probability 1/8; when all counters are depleted, trash becomes a physical litter entity. Broken bins reject trash, and handymen refill depleted corners to `0xff`. Physical litter does not age out; once the store reaches 500, adding litter evicts the newest item by persistent creation order, independent of saturating age and reusable entity ID. Save version 10 stores litter `birthOrder`; older saves migrate it from age descending, then entity ID ascending. Terrain edits remove litter on affected tiles. The staff system caches walkable and bin locations by map identity and revision. See [guest Noridoc](../../src/sim/guests/docs.md).
- OpenCoaster weather transitions among sunny, cloudy, rain and storm using the shared seeded random generator. Temperature follows scenario climate's March-October base table plus the current weather-kind delta; four-state transitions, durations and scoring remain partial. Rain and storm penalize thrill/coaster ride scores for guests without umbrellas; exposed guests without nearby shelter also lose happiness. A wandering guest near an open information kiosk checks nearby kiosks, skips prices they cannot afford, and buys at the first affordable price. Successful purchases deduct guest cash and post the kiosk price to `ShopSales`. Covered queues, weather visuals, and weather-specific stall behavior remain absent. See [weather Noridoc](../../src/sim/weather/docs.md) and [guest Noridoc](../../src/sim/guests/docs.md).
- Litter does not yet apply negative guest happiness thoughts. Wandering guests do receive the implemented generic scenery and very-clean thoughts from map counts; scenery is not catalogued, and fountain/music-specific effects remain absent.
- Bins and benches are path additions stored on path elements. Bins collect trash for handyman emptying. Every 32 ticks, a wandering guest on a litter/vomit tile refreshes a 2,048-tick litter-memory duration. When no anger countdown is active, a vandalism attempt requires happiness below 48, energy at least 85, and recent litter memory. A successful break sets 512 ticks of angriness, which bypasses those gates for further attempts. These durations are OpenCoaster assumptions, not verified reference-game timings. Security guards deter attempts within seven tiles. Breakage is held in a reserved element-payload bit, keeps the addition and bin contents, and can be repaired by replacing the path piece. There is no separate repair control, broken-item rendering, stopped/attempt counter, scenery targeting, or witness thought yet. See [map Noridoc](../../src/sim/map/docs.md) and [guest Noridoc](../../src/sim/guests/docs.md).
- Land ownership and construction rights are distinct per-tile flags; buys apply to tiles marked for sale and post land cost. Current prices are fixed constants rather than scenario inputs. Terrain commands charge changed unique corners on selected extreme tiles, and remove litter from the changed tiles. Scenery placement and scenario land price configuration remain unimplemented. See [map Noridoc](../../src/sim/map/docs.md).


---

## 8. Sources

Fetched and read:
- https://github.com/OpenRCT2/OpenRCT2/wiki (wiki index; no staff or weather page visible in listing)
- https://en.wikipedia.org/wiki/RollerCoaster_Tycoon_2 (park simulation summary)
- https://forums.openrct2.org/topic/6444-understanding-simulation-in-rct2/ (transport rides, rain cover, ride ratings; anecdotal)
- https://forums.openrct2.org/topic/6612-few-ideas-weather-handymen-ride-crashes-dual-track-rides-and-more (suggestions and some observations; mostly not verified)
- https://rct2.rctspace.com/rct2_manual.pdf (RollerCoaster Tycoon 2 manual; staff roles and the cited handyman monthly wage)

Seen in search results only (not fetched; HTTP 402 or search snippet only):
- https://rct.fandom.com/wiki/Guests_and_Staff (handymen, mechanics, staff wages, patrol advice)
- https://rct.fandom.com/wiki/Guest_Moods (happiness scale)
- https://rct.fandom.com/wiki/Guest_Thoughts (litter, vomit, scenery, clean-park thoughts)
- https://rct.fandom.com/wiki/Vandals (vandal mechanics)
- https://rct.fandom.com/wiki/Thunderstorm_Park/Scenario_Guide (indoor rides, 40% underground rule)
- https://rct.fandom.com/wiki/Hints_and_Tips (patrol advice)
- https://forums.rctgo.com/printthread.php?tid=20622 (patrol and mechanic rules of thumb)
- https://outof.games/realms/rollercoastertycoon/guides/541-guide-to-food-and-drink-stalls-in-rollercoaster-tycoon-1-and-2/ (rain and food sales)
- https://www.gog.com/forum/rollercoaster_tycoon_series/rct3_rides_and_rain (RCT3 only)
- https://strategywiki.org/wiki/RollerCoaster_Tycoon:_Corkscrew_Follies/Giggle_Downs (staff tips, not read)
- http://cdn.akamai.steamstatic.com/steam/apps/285310/manuals/rollercoaster_tycoon.pdf (RCT1 manual; scanned, unreadable through the fetch tool, not read)
