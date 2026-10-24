import { describe, expect, it } from 'vitest';
import { hashWorld } from '../core/hash';
import { Simulation } from '../core/simulation';
import { World } from '../core/world';
import { Surface } from '../map/tile-map';
import { WeatherKind } from '../weather/weather';
import { StaffKind, spawnStaff } from '../staff/staff-store';
import { deserialize, serialize } from '../../save/save';
import {
  BreakdownReason,
  breakRide,
  INSPECTION_INTERVAL_MINUTES,
  INSPECTION_MINUTE_TICKS,
  LOAD_TARGET_THRESHOLD,
  LoadTarget,
  RELIABILITY_FULL,
  RELIABILITY_MAX,
  RELIABILITY_CHECK_TICKS,
  RIDE_CATALOG,
  RideMode,
  RidePhase,
  RideState,
  RideType,
  VALUE_AGE_BANDS,
  breakdownReasonWeights,
  configureRide,
  connectRideQueue,
  createRide,
  getRideBreakdownReason,
  getRideMode,
  getRideRatings,
  getRideReliabilityRaw,
  getRideValueCents,
  isRideInspectionDue,
  joinRideQueue,
  placeRideEntranceExit,
  repairTicksFor,
  rideAgeAdjustedValue,
  rideSystem,
  rideValueUnits,
  serviceRide,
  setRideInspectionInterval,
  setRideMode,
  setRideOpen,
  setRidePrice,
  getRidePriceReaction,
  updateRideMaintenance,
} from './index';

function world(seed = 17): World {
  return new World({ seed, width: 16, height: 16 });
}

function preparedRide(w: World, type = RideType.MerryGoRound, x = 4, y = 4): number {
  const id = createRide(w, type, x, y);
  expect(placeRideEntranceExit(w, id, { x, y: y + 1 }, { x: x + 1, y })).toBe(true);
  for (const [px, py] of [
    [x - 1, y + 1],
    [x - 1, y + 2],
    [x - 1, y + 3],
    [x, y + 3],
    [x + 1, y + 3],
  ]) {
    w.map.surface[w.map.index(px, py)] = Surface.Path;
  }
  expect(
    connectRideQueue(w, id, [
      { x, y: y + 1 },
      { x: x - 1, y: y + 1 },
      { x: x - 1, y: y + 2 },
      { x: x - 1, y: y + 3 },
      { x, y: y + 3 },
      { x: x + 1, y: y + 3 },
    ]),
  ).toBe(true);
  return id;
}

function slotOf(w: World, id: number): number {
  return w.rides.idToSlot[id];
}

function setReliability(w: World, id: number, raw: number): void {
  w.rides.cols.reliabilityRaw[slotOf(w, id)] = raw;
}

function spawnMechanic(w: World): number {
  expect(spawnStaff(w, StaffKind.Mechanic)).toBe(true);
  return w.staff.slotToId[w.staff.count - 1];
}

describe('flat ride modes and ratings', () => {
  it('gives every ride type a default mode that its type permits', () => {
    for (const def of Object.values(RIDE_CATALOG)) {
      expect(def.modes.length).toBeGreaterThan(0);
      expect(def.modes.map((m) => m.mode)).toContain(def.modes[0].mode);
    }
    const w = world();
    const id = createRide(w, RideType.FerrisWheel, 4, 4);
    expect(getRideMode(w, id)).toBe(RideMode.ForwardRotation);
  });

  it('applies the selected mode adjustment to stored ratings and rejects foreign modes', () => {
    const w = world();
    const id = createRide(w, RideType.FerrisWheel, 4, 4);
    const forward = getRideRatings(w, id);

    expect(setRideMode(w, id, RideMode.BackwardRotation)).toBe(true);
    const backward = getRideRatings(w, id);
    expect(getRideMode(w, id)).toBe(RideMode.BackwardRotation);
    expect(backward).not.toEqual(forward);

    expect(setRideMode(w, id, RideMode.ForwardRotation)).toBe(true);
    expect(getRideRatings(w, id)).toEqual(forward);

    expect(setRideMode(w, id, RideMode.Swing)).toBe(false);
    expect(getRideMode(w, id)).toBe(RideMode.ForwardRotation);
  });

  it('changes mode only while the ride is closed', () => {
    const w = world();
    const id = preparedRide(w, RideType.FerrisWheel);
    expect(setRideOpen(w, id, true)).toBe(true);
    expect(setRideMode(w, id, RideMode.BackwardRotation)).toBe(false);
  });

  it('leaves stalls with a single shop mode', () => {
    expect(RIDE_CATALOG[RideType.FoodStall].modes.map((m) => m.mode)).toEqual([RideMode.Shop]);
  });
});

describe('dispatch load targets', () => {
  it('maps the five documented load targets to dispatch thresholds', () => {
    expect(LOAD_TARGET_THRESHOLD[LoadTarget.Any]).toBe(0);
    expect(LOAD_TARGET_THRESHOLD[LoadTarget.Quarter]).toBe(63);
    expect(LOAD_TARGET_THRESHOLD[LoadTarget.Half]).toBe(127);
    expect(LOAD_TARGET_THRESHOLD[LoadTarget.ThreeQuarters]).toBe(191);
    expect(LOAD_TARGET_THRESHOLD[LoadTarget.Full]).toBe(255);
  });

  it('holds a ride at 3/4 load until the line reaches three quarters of capacity', () => {
    const w = world();
    const id = preparedRide(w, RideType.MerryGoRound);
    expect(
      configureRide(w, id, {
        loadTarget: LoadTarget.ThreeQuarters,
        minWaitTicks: 1,
        maxWaitTicks: 5000,
        loadTicks: 1,
      }),
    ).toBe(true);
    expect(setRideOpen(w, id, true)).toBe(true);
    const capacity = RIDE_CATALOG[RideType.MerryGoRound].capacity;
    expect(joinRideQueue(w, id, capacity * 0.75 - 1)).toBe(true);
    for (let i = 0; i < 40; i++) rideSystem.update(w);
    expect(w.rides.cols.phase[slotOf(w, id)]).toBe(RidePhase.Waiting);

    expect(joinRideQueue(w, id, 1)).toBe(true);
    rideSystem.update(w);
    expect(w.rides.cols.phase[slotOf(w, id)]).toBe(RidePhase.Loading);
  });

  it('rejects an unknown load target', () => {
    const w = world();
    const id = preparedRide(w);
    expect(configureRide(w, id, { loadTarget: 9 as LoadTarget })).toBe(false);
  });
});

describe('inspection schedule', () => {
  it('offers the documented intervals plus never', () => {
    expect(INSPECTION_INTERVAL_MINUTES).toEqual([10, 20, 30, 45, 60, 120]);
    const w = world();
    const id = createRide(w, RideType.Twist, 4, 4);
    for (const minutes of INSPECTION_INTERVAL_MINUTES) {
      expect(setRideInspectionInterval(w, id, minutes)).toBe(true);
      expect(w.rides.cols.inspectionIntervalTicks[slotOf(w, id)]).toBe(
        minutes * INSPECTION_MINUTE_TICKS,
      );
    }
    expect(setRideInspectionInterval(w, id, 15)).toBe(false);
  });

  it('never schedules an inspection when the interval is never', () => {
    const w = world();
    const id = createRide(w, RideType.Twist, 4, 4);
    expect(setRideInspectionInterval(w, id, 0)).toBe(true);
    w.tick += 10_000_000;
    expect(isRideInspectionDue(w, id)).toBe(false);
  });

  it('applies the interval from the setRideInspection command', () => {
    const sim = new Simulation({ seed: 3, width: 16, height: 16 });
    const id = createRide(sim.world, RideType.Twist, 4, 4);
    sim.enqueue({ type: 'setRideInspection', rideId: id, minutes: 10 });
    sim.step();
    expect(sim.world.rides.cols.inspectionIntervalTicks[slotOf(sim.world, id)]).toBe(
      10 * INSPECTION_MINUTE_TICKS,
    );
  });

  it('never inspects stalls, which cannot break down', () => {
    const w = world();
    const id = createRide(w, RideType.FoodStall, 4, 4);
    w.tick += 10_000_000;
    expect(isRideInspectionDue(w, id)).toBe(false);
  });
});

describe('time-based reliability', () => {
  it('wears reliability on the check cadence, not per completed cycle', () => {
    const w = world();
    const id = createRide(w, RideType.Twist, 4, 4);
    const start = getRideReliabilityRaw(w, id);
    expect(start).toBe(RELIABILITY_MAX);

    w.tick = 1;
    updateRideMaintenance(w);
    expect(getRideReliabilityRaw(w, id)).toBe(start);

    w.tick = RELIABILITY_CHECK_TICKS;
    updateRideMaintenance(w);
    expect(getRideReliabilityRaw(w, id)).toBeLessThan(start);
  });

  it('wears older rides faster than new ones', () => {
    const w = world();
    const young = createRide(w, RideType.Twist, 4, 4);
    const old = createRide(w, RideType.Twist, 8, 8);
    w.rides.cols.ageMonths[slotOf(w, old)] = 8 * 6;
    w.tick = RELIABILITY_CHECK_TICKS;
    updateRideMaintenance(w);
    const youngLoss = RELIABILITY_MAX - getRideReliabilityRaw(w, young);
    const oldLoss = RELIABILITY_MAX - getRideReliabilityRaw(w, old);
    expect(oldLoss).toBeGreaterThan(youngLoss);
  });

  it('keeps the displayed percentage in step with the fine-grained value', () => {
    const w = world();
    const id = createRide(w, RideType.Twist, 4, 4);
    setReliability(w, id, 50 * 256 + 17);
    w.tick = RELIABILITY_CHECK_TICKS;
    updateRideMaintenance(w);
    const raw = getRideReliabilityRaw(w, id);
    expect(w.rides.cols.reliability[slotOf(w, id)]).toBe(Math.floor(raw / 256));
  });

  it('does not wear or break stalls', () => {
    const w = world();
    const id = preparedRide(w, RideType.FoodStall);
    expect(setRideOpen(w, id, true)).toBe(true);
    setReliability(w, id, 0);
    for (let t = 1; t <= 50; t++) {
      w.tick = t * RELIABILITY_CHECK_TICKS;
      updateRideMaintenance(w);
    }
    expect(w.rides.cols.state[slotOf(w, id)]).toBe(RideState.Open);
  });
});

describe('breakdown rolls and reasons', () => {
  function openRide(w: World, type = RideType.Twist): number {
    const id = preparedRide(w, type);
    expect(setRideOpen(w, id, true)).toBe(true);
    return id;
  }

  it('forces a breakdown at the next check when reliability is zero', () => {
    const w = world();
    const id = openRide(w);
    setReliability(w, id, 0);
    w.tick = RELIABILITY_CHECK_TICKS;
    updateRideMaintenance(w);
    const slot = slotOf(w, id);
    expect(w.rides.cols.state[slot]).toBe(RideState.Broken);
    expect(w.rides.cols.phase[slot]).toBe(RidePhase.Broken);
    expect(w.rides.cols.breakdownCounter[slot]).toBe(1);
    expect(getRideBreakdownReason(w, id)).not.toBe(BreakdownReason.None);
  });

  it('breaks at the documented per-check rate for a given reliability', () => {
    const reliability = 12_000;
    const expected = (25_857 - reliability) / 3_145_728;
    let breaks = 0;
    const trials = 40_000;
    const w = world(5);
    const id = openRide(w, RideType.MerryGoRound);
    const slot = slotOf(w, id);
    for (let i = 0; i < trials; i++) {
      w.rides.cols.state[slot] = RideState.Open;
      w.rides.cols.phase[slot] = RidePhase.Waiting;
      w.rides.cols.reliabilityRaw[slot] = reliability;
      w.rides.cols.ageMonths[slot] = 0;
      const before = w.rides.cols.breakdownCounter[slot];
      w.tick = (i + 1) * RELIABILITY_CHECK_TICKS;
      updateRideMaintenance(w);
      if (w.rides.cols.breakdownCounter[slot] > before) breaks++;
    }
    const rate = breaks / trials;
    expect(rate).toBeGreaterThan(expected * 0.7);
    expect(rate).toBeLessThan(expected * 1.3);
  });

  it('never rolls a breakdown for a closed ride', () => {
    const w = world();
    const id = preparedRide(w, RideType.Twist);
    setReliability(w, id, 0);
    w.tick = RELIABILITY_CHECK_TICKS;
    updateRideMaintenance(w);
    expect(w.rides.cols.state[slotOf(w, id)]).toBe(RideState.Closed);
  });

  it('selects only reasons the ride type allows', () => {
    const allowed = new Set(RIDE_CATALOG[RideType.Twist].breakdowns.map((b) => b.reason));
    const w = world(9);
    const id = openRide(w, RideType.Twist);
    const slot = slotOf(w, id);
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      w.rides.cols.state[slot] = RideState.Open;
      w.rides.cols.phase[slot] = RidePhase.Waiting;
      w.rides.cols.reliabilityRaw[slot] = 0;
      w.tick = (i + 1) * RELIABILITY_CHECK_TICKS;
      updateRideMaintenance(w);
      seen.add(getRideBreakdownReason(w, id));
    }
    expect(seen.size).toBeGreaterThan(1);
    for (const reason of seen) expect(allowed.has(reason)).toBe(true);
  });

  it('uses the documented coaster reason mix and raises brakes failure weight in rain', () => {
    const dry = breakdownReasonWeights(RideType.WoodenCoaster, WeatherKind.Sunny);
    expect(dry.map((b) => [b.reason, b.weight])).toEqual([
      [BreakdownReason.SafetyCutOut, 25],
      [BreakdownReason.RestraintsStuckClosed, 12],
      [BreakdownReason.RestraintsStuckOpen, 10],
      [BreakdownReason.VehicleMalfunction, 6],
      [BreakdownReason.BrakesFailure, 3],
    ]);
    const wet = breakdownReasonWeights(RideType.WoodenCoaster, WeatherKind.Rain);
    expect(wet.find((b) => b.reason === BreakdownReason.BrakesFailure)?.weight).toBe(20);
    expect(wet.filter((b) => b.reason !== BreakdownReason.BrakesFailure)).toEqual(
      dry.filter((b) => b.reason !== BreakdownReason.BrakesFailure),
    );
  });

  it('keeps riders aboard when restraints stick closed, and frees them at repair', () => {
    const w = world();
    const id = preparedRide(w, RideType.MerryGoRound);
    const slot = slotOf(w, id);
    configureRide(w, id, { minWaitTicks: 1, maxWaitTicks: 1, loadTicks: 1, runTicks: 500 });
    expect(setRideOpen(w, id, true)).toBe(true);
    expect(joinRideQueue(w, id, 3)).toBe(true);
    rideSystem.update(w);
    rideSystem.update(w);
    expect(w.rides.cols.phase[slot]).toBe(RidePhase.Running);

    breakRide(w, slot, BreakdownReason.RestraintsStuckClosed);
    expect(w.rides.cols.state[slot]).toBe(RideState.Broken);
    expect(w.rides.cols.boarded[slot]).toBe(3);
    expect(w.rides.cols.guestsServed[slot]).toBe(0);

    const mechanic = spawnMechanic(w);
    for (let i = 0; i < repairTicksFor(BreakdownReason.RestraintsStuckClosed); i++) {
      w.tick++;
      serviceRide(w, id, mechanic);
    }
    expect(w.rides.cols.boarded[slot]).toBe(0);
    expect(w.rides.cols.guestsServed[slot]).toBe(3);
    expect(w.rides.cols.state[slot]).toBe(RideState.Open);
  });

  it('lets other reasons release riders immediately', () => {
    const w = world();
    const id = preparedRide(w, RideType.MerryGoRound);
    const slot = slotOf(w, id);
    configureRide(w, id, { minWaitTicks: 1, maxWaitTicks: 1, loadTicks: 1, runTicks: 500 });
    expect(setRideOpen(w, id, true)).toBe(true);
    expect(joinRideQueue(w, id, 3)).toBe(true);
    rideSystem.update(w);
    rideSystem.update(w);
    breakRide(w, slot, BreakdownReason.SafetyCutOut);
    expect(w.rides.cols.boarded[slot]).toBe(0);
    expect(w.rides.cols.guestsServed[slot]).toBe(3);
  });
});

describe('mechanic service', () => {
  function brokenRide(w: World, reason = BreakdownReason.SafetyCutOut): number {
    const id = preparedRide(w, RideType.Twist);
    expect(setRideOpen(w, id, true)).toBe(true);
    breakRide(w, slotOf(w, id), reason);
    return id;
  }

  it('needs sustained presence for the repair duration', () => {
    const w = world();
    const id = brokenRide(w);
    const mechanic = spawnMechanic(w);
    const needed = repairTicksFor(BreakdownReason.SafetyCutOut);
    for (let i = 0; i < needed - 1; i++) {
      w.tick++;
      expect(serviceRide(w, id, mechanic)).toBe(false);
    }
    expect(w.rides.cols.state[slotOf(w, id)]).toBe(RideState.Broken);
    w.tick++;
    expect(serviceRide(w, id, mechanic)).toBe(true);
    expect(w.rides.cols.state[slotOf(w, id)]).toBe(RideState.Open);
    expect(getRideBreakdownReason(w, id)).toBe(BreakdownReason.None);
  });

  it('restarts the work when the mechanic leaves before finishing', () => {
    const w = world();
    const id = brokenRide(w);
    const mechanic = spawnMechanic(w);
    const needed = repairTicksFor(BreakdownReason.SafetyCutOut);
    for (let i = 0; i < needed - 1; i++) {
      w.tick++;
      serviceRide(w, id, mechanic);
    }
    w.tick += 100;
    expect(serviceRide(w, id, mechanic)).toBe(false);
    expect(w.rides.cols.state[slotOf(w, id)]).toBe(RideState.Broken);
  });

  it('counts two mechanics on the same tick once', () => {
    const w = world();
    const id = brokenRide(w);
    const a = spawnMechanic(w);
    const b = spawnMechanic(w);
    const needed = repairTicksFor(BreakdownReason.SafetyCutOut);
    for (let i = 0; i < needed - 1; i++) {
      w.tick++;
      serviceRide(w, id, a);
      serviceRide(w, id, b);
    }
    expect(w.rides.cols.state[slotOf(w, id)]).toBe(RideState.Broken);
  });

  it('takes longer for restraint failures than for a safety cut-out', () => {
    expect(repairTicksFor(BreakdownReason.RestraintsStuckClosed)).toBeGreaterThan(
      repairTicksFor(BreakdownReason.SafetyCutOut),
    );
  });

  it('restores floor(missing / 4) times a random byte on inspection, nothing for a one-point gap', () => {
    const w = world(21);
    const id = preparedRide(w, RideType.Twist);
    const slot = slotOf(w, id);
    const mechanic = spawnMechanic(w);
    const inspect = (raw: number): number => {
      w.rides.cols.reliabilityRaw[slot] = raw;
      w.rides.cols.serviceTicks[slot] = 0;
      for (let i = 0; i < 1000; i++) {
        w.tick++;
        if (serviceRide(w, id, mechanic)) break;
      }
      return getRideReliabilityRaw(w, id) - raw;
    };

    expect(inspect(99 * 256 + 100)).toBe(0);
    const gains = new Set<number>();
    for (let i = 0; i < 30; i++) {
      const gain = inspect(60 * 256);
      expect(gain).toBeGreaterThanOrEqual(0);
      expect(gain).toBeLessThanOrEqual(10 * 255);
      expect(gain % 10).toBe(0);
      gains.add(gain);
    }
    expect(gains.size).toBeGreaterThan(5);
    w.rides.cols.reliabilityRaw[slot] = RELIABILITY_MAX - 1;
    expect(getRideReliabilityRaw(w, id)).toBeLessThanOrEqual(RELIABILITY_MAX);
  });

  it('resets the inspection timer after a completed inspection', () => {
    const w = world();
    const id = preparedRide(w, RideType.Twist);
    const slot = slotOf(w, id);
    const mechanic = spawnMechanic(w);
    w.tick = 100_000;
    expect(isRideInspectionDue(w, id)).toBe(true);
    for (let i = 0; i < 1000; i++) {
      w.tick++;
      if (serviceRide(w, id, mechanic)) break;
    }
    expect(w.rides.cols.lastInspectionTick[slot]).toBe(w.tick);
    expect(isRideInspectionDue(w, id)).toBe(false);
  });
});

describe('ride value', () => {
  it('reproduces the documented fixed-point rating arithmetic', () => {
    expect(rideValueUnits({ excitement: 800, intensity: 550, nausea: 400 }, [51, 32, 10])).toBe(59);
  });

  it('applies the vanilla age schedule', () => {
    expect(VALUE_AGE_BANDS.length).toBeGreaterThan(8);
    const base = 100;
    expect(rideAgeAdjustedValue(base, 0)).toBe(130);
    expect(rideAgeAdjustedValue(base, 4)).toBe(130);
    expect(rideAgeAdjustedValue(base, 5)).toBe(110);
    expect(rideAgeAdjustedValue(base, 12)).toBe(110);
    expect(rideAgeAdjustedValue(base, 13)).toBe(100);
    expect(rideAgeAdjustedValue(base, 39)).toBe(100);
    expect(rideAgeAdjustedValue(base, 40)).toBe(75);
    expect(rideAgeAdjustedValue(base, 64)).toBe(56);
    expect(rideAgeAdjustedValue(base, 88)).toBe(42);
    expect(rideAgeAdjustedValue(base, 104)).toBe(32);
    expect(rideAgeAdjustedValue(base, 120)).toBe(16);
    expect(rideAgeAdjustedValue(base, 128)).toBe(8);
    expect(rideAgeAdjustedValue(base, 200)).toBe(56);
  });

  it('converts internal value units to cents at ten cents a unit', () => {
    const w = world();
    const id = createRide(w, RideType.SwingingShip, 4, 4);
    const def = RIDE_CATALOG[RideType.SwingingShip];
    const units = rideAgeAdjustedValue(rideValueUnits(getRideRatings(w, id), def.valueWeights), 0);
    expect(getRideValueCents(w, id)).toBe(units * 10);
  });

  it('cuts every same-type ride by a quarter once a second one is open', () => {
    const w = world();
    const a = preparedRide(w, RideType.Twist, 2, 2);
    const b = preparedRide(w, RideType.Twist, 9, 9);
    const alone = getRideValueCents(w, a);
    expect(setRideOpen(w, a, true)).toBe(true);
    expect(getRideValueCents(w, a)).toBe(alone);
    expect(setRideOpen(w, b, true)).toBe(true);
    expect(getRideValueCents(w, a)).toBe(Math.floor(((alone / 10) * 75) / 100) * 10);
    expect(getRideValueCents(w, b)).toBe(getRideValueCents(w, a));
  });

  it('values stalls at nothing', () => {
    const w = world();
    expect(getRideValueCents(w, createRide(w, RideType.FoodStall, 4, 4))).toBe(0);
  });

  it('calls a ride good value at half its value and too expensive beyond twice it', () => {
    const w = world();
    const id = createRide(w, RideType.Twist, 4, 4);
    const value = getRideValueCents(w, id);
    setRidePrice(w, id, value / 2);
    expect(getRidePriceReaction(w, id)).toBe('good-value');
    setRidePrice(w, id, value / 2 + 10);
    expect(getRidePriceReaction(w, id)).toBe('fair-value');
    setRidePrice(w, id, value * 2);
    expect(getRidePriceReaction(w, id)).toBe('fair-value');
    setRidePrice(w, id, value * 2 + 10);
    expect(getRidePriceReaction(w, id)).toBe('too-expensive');
  });
});

describe('stall pricing', () => {
  it('starts each stall at its own default price', () => {
    const w = world();
    const prices = [
      RideType.FoodStall,
      RideType.DrinkStall,
      RideType.InformationKiosk,
      RideType.Toilets,
    ].map((type) => w.rides.cols.price[slotOf(w, createRide(w, type, type, 2))]);
    expect(new Set(prices).size).toBeGreaterThan(2);
    expect(RELIABILITY_FULL).toBe(100 * 256);
  });
});

describe('determinism and saves', () => {
  function run(seed: number, ticks: number): Simulation {
    const sim = new Simulation({ seed, width: 24, height: 24 });
    const id = preparedRide(sim.world, RideType.Twist);
    expect(setRideOpen(sim.world, id, true)).toBe(true);
    sim.world.rides.cols.reliabilityRaw[slotOf(sim.world, id)] = 8_000;
    spawnMechanic(sim.world);
    for (let t = 0; t < ticks; t++) sim.step();
    return sim;
  }

  it('replays identically with breakdowns, repairs and inspections in play', () => {
    const a = run(77, 20_000);
    const b = run(77, 20_000);
    expect(hashWorld(a.world)).toBe(hashWorld(b.world));
    expect(a.world.rides.cols.breakdownCounter[0]).toBeGreaterThan(0);
    const c = run(78, 20_000);
    expect(hashWorld(c.world)).not.toBe(hashWorld(a.world));
  });

  it('round-trips mid-breakdown state through save and load', () => {
    const sim = run(5, 3_000);
    const loaded = deserialize(serialize(sim.world));
    expect(hashWorld(loaded)).toBe(hashWorld(sim.world));
    expect(loaded.rides.cols.reliabilityRaw[0]).toBe(sim.world.rides.cols.reliabilityRaw[0]);
  });

  it('migrates a version 9 save by scaling percent reliability and defaulting the mode', () => {
    const w = world();
    const id = createRide(w, RideType.FerrisWheel, 4, 4);
    w.rides.cols.reliability[slotOf(w, id)] = 64;
    w.research.progress = 21;
    w.research.inventions = [{ itemId: 8, category: 0, workUnits: 21 }];
    const loaded = deserialize(downgradeToVersion9(w));
    const slot = loaded.rides.idToSlot[id];
    expect(loaded.rides.cols.reliabilityRaw[slot]).toBe(64 * 256);
    expect(loaded.rides.cols.mode[slot]).toBe(RideMode.ForwardRotation);
    expect(loaded.rides.cols.reliability[slot]).toBe(64);
    expect(loaded.research.progress).toBe(21);
    expect(loaded.research.inventions.every((invention) => invention.workUnits === 21)).toBe(true);
  });
});

/** Rewrites a current save as version 9: no columns beyond `incomeCents`. */
function downgradeToVersion9(w: World): Uint8Array {
  const current = serialize(w);
  const view = new DataView(current.buffer, current.byteOffset, current.byteLength);
  const headerEnd = 8 + view.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(current.subarray(8, headerEnd)));
  header.version = 9;
  header.research.progress = 2_500;
  header.research.inventions = header.research.inventions.map(
    (invention: { itemId: number; category: number }) => ({
      ...invention,
      costCents: 2_500,
    }),
  );
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const added = ['reliabilityRaw', 'mode', 'breakdownReason', 'serviceTicks', 'serviceLastTick'];
  const rideArrays = w.rides.arrays();
  const cols = w.rides.cols as unknown as Record<string, ArrayBufferView>;
  const guestColumns = w.guests.cols;
  const dropped = new Set<ArrayBufferView>([
    ...added.map((name) => cols[name]),
    guestColumns.navGoal,
    guestColumns.navGap,
    guestColumns.navSteps,
    guestColumns.lostTicks,
    guestColumns.hasMap,
    guestColumns.visitTicks,
    guestColumns.ridesTaken,
    guestColumns.lastRide,
    guestColumns.rideHistoryCursor,
    guestColumns.rideHistory0,
    guestColumns.rideHistory1,
    guestColumns.rideHistory2,
    guestColumns.rideHistory3,
    w.staff.cols.orderFlags,
  ]);
  const head = current.subarray(headerEnd);
  const sections: Uint8Array[] = [];
  let offset = 0;
  const take = (array: ArrayBufferView): Uint8Array => {
    const bytes = head.subarray(offset, offset + array.byteLength);
    offset += array.byteLength;
    return bytes;
  };
  const arrays: ArrayBufferView[] = [
    ...w.map.arrays(),
    ...w.guests.arrays(),
    ...w.staff.arrays(),
    ...w.vehicles.arrays(),
    ...w.litter.arrays(),
    ...rideArrays,
    ...w.track.pieces.arrays(),
    ...w.track.rideTables(),
  ];
  for (const array of arrays) {
    const bytes = take(array);
    if (!dropped.has(array)) sections.push(bytes);
  }
  const total = sections.reduce((n, s) => n + s.byteLength, 0);
  const out = new Uint8Array(8 + headerBytes.length + total);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, view.getUint32(0, true), true);
  outView.setUint32(4, headerBytes.length, true);
  out.set(headerBytes, 8);
  let at = 8 + headerBytes.length;
  for (const s of sections) {
    out.set(s, at);
    at += s.byteLength;
  }
  return out;
}
