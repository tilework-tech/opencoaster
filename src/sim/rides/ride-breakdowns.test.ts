import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { Surface } from '../map/tile-map';
import { createRideAtCorner } from '../integration/fixtures';
import { WeatherKind } from '../weather/weather';
import { StaffKind, spawnStaff } from '../staff/staff-store';
import {
  BreakdownReason,
  RELIABILITY_CHECK_TICKS,
  RELIABILITY_MAX,
  RideMode,
  RidePhase,
  RideState,
  RideType,
  breakRide,
  breakdownReasonWeights,
  connectRideQueue,
  createRide,
  getAverageRideDowntimePercent,
  getRideBreakdownReason,
  getRideDowntimePercent,
  getRideReliabilityRaw,
  isRideInspectionDue,
  placeRideEntranceExit,
  serviceRide,
  setRideInspectionInterval,
  setRideOpen,
  updateRideMaintenance,
} from './index';

/** RCT2 ticks run at the same 40 per second as ours, so its tick counts apply unconverted. */
const RCT2_DOWNTIME_WINDOW_TICKS = 8192;
const RCT2_INSPECTION_MINUTE_TICKS = 2048;
const MONTHS_PER_YEAR = 8;

function world(seed = 17): World {
  return new World({ seed, width: 16, height: 16 });
}

function slotOf(w: World, id: number): number {
  return w.rides.idToSlot[id];
}

function setReliability(w: World, id: number, raw: number): void {
  w.rides.cols.reliabilityRaw[slotOf(w, id)] = raw;
}

function preparedRide(w: World, type: RideType, x = 4, y = 4): number {
  const id = createRideAtCorner(w, type, [x, y]);
  expect(placeRideEntranceExit(w, id, { x, y: y + 1 }, { x: x + 1, y })).toBe(true);
  const line = [
    { x, y: y + 1 },
    { x: x - 1, y: y + 1 },
    { x: x - 1, y: y + 2 },
    { x: x - 1, y: y + 3 },
    { x, y: y + 3 },
    { x: x + 1, y: y + 3 },
  ];
  for (const tile of line) w.map.surface[w.map.index(tile.x, tile.y)] = Surface.Path;
  expect(connectRideQueue(w, id, line)).toBe(true);
  return id;
}

function openRide(w: World, type: RideType): number {
  const id = preparedRide(w, type);
  expect(setRideOpen(w, id, true)).toBe(true);
  return id;
}

/** An open ride placed without queue or entrance, for types that do not need a layout. */
function bareOpenRide(w: World, type: RideType): number {
  const id = createRide(w, type, 4, 4);
  w.rides.cols.state[slotOf(w, id)] = RideState.Open;
  w.rides.cols.phase[slotOf(w, id)] = RidePhase.Waiting;
  return id;
}

/** Runs one reliability check at the next multiple of the check interval. */
function runCheck(w: World): void {
  w.tick = (Math.floor(w.tick / RELIABILITY_CHECK_TICKS) + 1) * RELIABILITY_CHECK_TICKS;
  updateRideMaintenance(w);
}

/** Reliability an open ride of `type` and `ageMonths` loses in one check. */
function wearPerCheck(type: RideType, ageMonths: number): number {
  const w = world();
  const id = createRide(w, type, 4, 4);
  const start = 20_000;
  setReliability(w, id, start);
  w.rides.cols.state[slotOf(w, id)] = RideState.Open;
  w.rides.cols.ageMonths[slotOf(w, id)] = ageMonths;
  w.tick = RELIABILITY_CHECK_TICKS;
  updateRideMaintenance(w);
  return start - getRideReliabilityRaw(w, id);
}

describe('reliability decay', () => {
  it('wears a new ride by its type factor each check', () => {
    expect(wearPerCheck(RideType.Twist, 0)).toBe(16);
    expect(wearPerCheck(RideType.Enterprise, 0)).toBe(22);
    expect(wearPerCheck(RideType.WoodenCoaster, 0)).toBe(19);
    expect(wearPerCheck(RideType.JuniorRollerCoaster, 0)).toBe(13);
    expect(wearPerCheck(RideType.HauntedHouse, 0)).toBe(8);
  });

  it('adds the age penalty to the factor year by year', () => {
    const factor = 16;
    const penaltyByYear = [
      0,
      factor / 8,
      factor / 4,
      factor / 2,
      factor / 2,
      factor,
      factor,
      factor,
      2 * factor,
      2 * factor,
    ];
    penaltyByYear.forEach((penalty, year) => {
      expect(wearPerCheck(RideType.Twist, year * MONTHS_PER_YEAR)).toBe(factor + penalty);
    });
  });

  it('rounds the age penalty down', () => {
    expect(wearPerCheck(RideType.WoodenCoaster, MONTHS_PER_YEAR)).toBe(19 + 2);
    expect(wearPerCheck(RideType.WoodenCoaster, 2 * MONTHS_PER_YEAR)).toBe(19 + 4);
  });

  it('stops at zero reliability', () => {
    const w = world();
    const id = createRide(w, RideType.Twist, 4, 4);
    w.rides.cols.state[slotOf(w, id)] = RideState.Open;
    setReliability(w, id, 5);
    runCheck(w);
    expect(getRideReliabilityRaw(w, id)).toBe(0);
  });

  it('keeps a ride that cannot break down at full reliability', () => {
    const w = world();
    const id = createRide(w, RideType.FoodStall, 4, 4);
    w.rides.cols.state[slotOf(w, id)] = RideState.Open;
    setReliability(w, id, 100);
    runCheck(w);
    expect(getRideReliabilityRaw(w, id)).toBe(RELIABILITY_MAX);
  });

  it('does not wear a closed ride', () => {
    const w = world();
    const id = createRide(w, RideType.Twist, 4, 4);
    setReliability(w, id, 20_000);
    for (let i = 0; i < 10; i++) runCheck(w);
    expect(getRideReliabilityRaw(w, id)).toBe(20_000);
  });
});

describe('breakdown roll', () => {
  function breakRate(type: RideType, reliability: number, trials: number): number {
    const w = world(5);
    const id = openRide(w, type);
    const slot = slotOf(w, id);
    let breaks = 0;
    for (let i = 0; i < trials; i++) {
      w.rides.cols.state[slot] = RideState.Open;
      w.rides.cols.phase[slot] = RidePhase.Waiting;
      w.rides.cols.reliabilityRaw[slot] = reliability;
      w.rides.cols.ageMonths[slot] = 0;
      runCheck(w);
      if (w.rides.cols.state[slot] === RideState.Broken) breaks++;
    }
    return breaks / trials;
  }

  it('breaks with probability (25857 - reliability) / 2^21 per check', () => {
    // The roll sees the reliability after this check's wear (the Twist's 16).
    const reliability = 12_000;
    const probability = (25_857 - (reliability - 16)) / 2 ** 21;
    const trials = 200_000;
    const rate = breakRate(RideType.Twist, reliability, trials);
    const sigma = Math.sqrt((probability * (1 - probability)) / trials);
    expect(Math.abs(rate - probability)).toBeLessThan(4 * sigma);
  });

  it('always breaks a ride with no reliability left', () => {
    expect(breakRate(RideType.Twist, 0, 200)).toBe(1);
  });

  it('records reduced reliability and downtime after a naturally rolled breakdown', () => {
    let w: World | undefined;
    let id = -1;
    let slot = -1;
    for (let seed = 1; seed <= 1_000; seed++) {
      const candidate = world(seed);
      const candidateId = openRide(candidate, RideType.Twist);
      const candidateSlot = slotOf(candidate, candidateId);
      setReliability(candidate, candidateId, 5_000);
      runCheck(candidate);
      if (
        candidate.rides.cols.state[candidateSlot] === RideState.Broken &&
        candidate.rides.cols.reliability[candidateSlot] > 0
      ) {
        w = candidate;
        id = candidateId;
        slot = candidateSlot;
        break;
      }
    }

    expect(w).toBeDefined();
    if (!w) throw new Error('no seed naturally broke the ride above zero reliability');
    expect(w.rides.cols.state[slot]).toBe(RideState.Broken);
    expect(w.rides.cols.reliability[slot]).toBeGreaterThan(0);
    expect(w.rides.cols.reliability[slot]).toBeLessThan(100);

    const nextWindow =
      Math.ceil((w.tick + 1) / RCT2_DOWNTIME_WINDOW_TICKS) * RCT2_DOWNTIME_WINDOW_TICKS;
    while (w.tick < nextWindow) runCheck(w);

    expect(getRideDowntimePercent(w, id)).toBeGreaterThan(0);
  });

  it('never breaks a closed ride or a ride type without breakdowns', () => {
    const w = world();
    const closed = preparedRide(w, RideType.Twist);
    setReliability(w, closed, 0);
    const stall = createRide(w, RideType.FoodStall, 10, 10);
    w.rides.cols.state[slotOf(w, stall)] = RideState.Open;
    setReliability(w, stall, 0);
    for (let i = 0; i < 20; i++) runCheck(w);
    expect(w.rides.cols.state[slotOf(w, closed)]).toBe(RideState.Closed);
    expect(w.rides.cols.state[slotOf(w, stall)]).toBe(RideState.Open);
  });
});

describe('breakdown types by ride class', () => {
  const reasonsFor = (type: RideType): BreakdownReason[] =>
    breakdownReasonWeights(type, WeatherKind.Sunny).map((entry) => entry.reason);

  it('gives most flat rides only the safety cut-out', () => {
    for (const type of [
      RideType.SwingingShip,
      RideType.FerrisWheel,
      RideType.Twist,
      RideType.HauntedHouse,
      RideType.SpiralSlide,
      RideType.TopSpin,
      RideType.Enterprise,
      RideType.Chairlift,
    ]) {
      expect(reasonsFor(type)).toEqual([BreakdownReason.SafetyCutOut]);
    }
  });

  it('adds control failure to the merry-go-round', () => {
    expect(reasonsFor(RideType.MerryGoRound)).toEqual([
      BreakdownReason.SafetyCutOut,
      BreakdownReason.ControlFailure,
    ]);
  });

  it('gives roller coasters restraint, vehicle and brake failures but no doors', () => {
    for (const type of [
      RideType.WoodenCoaster,
      RideType.SteelLoopingCoaster,
      RideType.JuniorRollerCoaster,
      RideType.WildMouseCoaster,
    ]) {
      const reasons = reasonsFor(type);
      expect(reasons).toEqual([
        BreakdownReason.SafetyCutOut,
        BreakdownReason.RestraintsStuckClosed,
        BreakdownReason.RestraintsStuckOpen,
        BreakdownReason.VehicleMalfunction,
        BreakdownReason.BrakesFailure,
      ]);
    }
  });

  it('gives each transport and water ride its own set', () => {
    expect(reasonsFor(RideType.GoKarts)).toEqual([BreakdownReason.VehicleMalfunction]);
    expect(reasonsFor(RideType.LogFlume)).toEqual([
      BreakdownReason.SafetyCutOut,
      BreakdownReason.BrakesFailure,
    ]);
    expect(reasonsFor(RideType.RiverRapids)).toEqual([
      BreakdownReason.SafetyCutOut,
      BreakdownReason.BrakesFailure,
    ]);
    expect(reasonsFor(RideType.MiniatureRailway)).toEqual([
      BreakdownReason.SafetyCutOut,
      BreakdownReason.VehicleMalfunction,
    ]);
    expect(reasonsFor(RideType.Monorail)).toEqual([
      BreakdownReason.SafetyCutOut,
      BreakdownReason.DoorsStuckClosed,
      BreakdownReason.DoorsStuckOpen,
      BreakdownReason.VehicleMalfunction,
    ]);
    expect(reasonsFor(RideType.ObservationTower)).toEqual([
      BreakdownReason.SafetyCutOut,
      BreakdownReason.VehicleMalfunction,
    ]);
  });

  it('uses the shared reason weights', () => {
    const monorail = breakdownReasonWeights(RideType.Monorail, WeatherKind.Sunny);
    expect(monorail.map((entry) => entry.weight)).toEqual([25, 13, 10, 6]);
    const merry = breakdownReasonWeights(RideType.MerryGoRound, WeatherKind.Sunny);
    expect(merry.map((entry) => entry.weight)).toEqual([25, 3]);
  });

  it('never breaks shops, stalls, toilets or kiosks', () => {
    for (const type of [
      RideType.FoodStall,
      RideType.DrinkStall,
      RideType.BurgerStall,
      RideType.InformationKiosk,
      RideType.Toilets,
    ]) {
      expect(reasonsFor(type)).toEqual([]);
    }
  });
});

describe('brakes failure gates', () => {
  /** Breakdowns and brakes failures over forced rolls (reliability 0) on a log flume in rain. */
  function rainyRolls(ageMonths: number, reliabilityRaw: number, trials: number) {
    const w = world(11);
    w.weather.kind = WeatherKind.Rain;
    const id = bareOpenRide(w, RideType.LogFlume);
    const slot = slotOf(w, id);
    let breakdowns = 0;
    let brakes = 0;
    for (let i = 0; i < trials; i++) {
      w.rides.cols.state[slot] = RideState.Open;
      w.rides.cols.phase[slot] = RidePhase.Waiting;
      w.rides.cols.breakdownReason[slot] = BreakdownReason.None;
      w.rides.cols.reliabilityRaw[slot] = reliabilityRaw;
      w.rides.cols.ageMonths[slot] = ageMonths;
      w.tick = (i + 1) * RELIABILITY_CHECK_TICKS;
      updateRideMaintenance(w);
      if (w.rides.cols.state[slot] === RideState.Broken) {
        breakdowns++;
        if (getRideBreakdownReason(w, id) === BreakdownReason.BrakesFailure) brakes++;
      }
    }
    return { breakdowns, brakes };
  }

  it('allows brakes failure on a ride 16 months old with reliability at or below 50%', () => {
    const { brakes } = rainyRolls(16, 0, 500);
    expect(brakes).toBeGreaterThan(0);
  });

  it('discards brakes failure on a ride under 16 months old, leaving no breakdown', () => {
    const { breakdowns, brakes } = rainyRolls(15, 0, 2_000);
    expect(brakes).toBe(0);
    // Rain weights: cut-out 25, brakes 20, so about 25/45 of forced rolls survive.
    expect(breakdowns / 2_000).toBeGreaterThan(0.5);
    expect(breakdowns / 2_000).toBeLessThan(0.61);
  });

  it('discards brakes failure while reliability is above 50%', () => {
    const { breakdowns, brakes } = rainyRolls(40, 51 * 256 + 100, 200_000);
    expect(breakdowns).toBeGreaterThan(300);
    expect(brakes).toBe(0);
  });

  it('weights brakes failure 20 in rain and 3 otherwise', () => {
    const dry = breakdownReasonWeights(RideType.LogFlume, WeatherKind.Sunny);
    const wet = breakdownReasonWeights(RideType.LogFlume, WeatherKind.Rain);
    expect(dry.find((e) => e.reason === BreakdownReason.BrakesFailure)?.weight).toBe(3);
    expect(wet.find((e) => e.reason === BreakdownReason.BrakesFailure)?.weight).toBe(20);
  });

  it('discards brakes failure on a block-sectioned ride that runs several trains', () => {
    const roll = (trainCount: number) => {
      const w = world(13);
      w.weather.kind = WeatherKind.Rain;
      const id = createRide(w, RideType.WoodenCoaster, 4, 4);
      const slot = slotOf(w, id);
      w.rides.cols.mode[slot] = RideMode.ContinuousCircuitBlockSectioned;
      w.rides.cols.trainCount[slot] = trainCount;
      let brakes = 0;
      for (let i = 0; i < 400; i++) {
        w.rides.cols.state[slot] = RideState.Open;
        w.rides.cols.phase[slot] = RidePhase.Waiting;
        w.rides.cols.breakdownReason[slot] = BreakdownReason.None;
        w.rides.cols.reliabilityRaw[slot] = 0;
        w.rides.cols.ageMonths[slot] = 40;
        w.tick = (i + 1) * RELIABILITY_CHECK_TICKS;
        updateRideMaintenance(w);
        if (getRideBreakdownReason(w, id) === BreakdownReason.BrakesFailure) brakes++;
      }
      return brakes;
    };
    expect(roll(3)).toBe(0);
    expect(roll(1)).toBeGreaterThan(0);
  });
});

describe('rolling downtime', () => {
  function brokenFor(w: World, id: number, checks: number): void {
    const slot = slotOf(w, id);
    breakRide(w, slot, BreakdownReason.SafetyCutOut);
    for (let i = 0; i < checks; i++) runCheck(w);
    w.rides.cols.state[slot] = RideState.Closed;
    w.rides.cols.phase[slot] = RidePhase.Closed;
  }

  /** Advances to just past the next downtime window boundary. */
  function crossWindow(w: World): void {
    w.tick = (Math.floor(w.tick / RCT2_DOWNTIME_WINDOW_TICKS) + 1) * RCT2_DOWNTIME_WINDOW_TICKS;
    updateRideMaintenance(w);
  }

  it('starts at zero', () => {
    const w = world();
    const id = createRide(w, RideType.Twist, 4, 4);
    expect(getRideDowntimePercent(w, id)).toBe(0);
  });

  it('counts half the broken checks at each window boundary', () => {
    const w = world();
    const id = createRide(w, RideType.Twist, 4, 4);
    brokenFor(w, id, 16);
    crossWindow(w);
    expect(getRideDowntimePercent(w, id)).toBe(8);
  });

  it('reads 16 after a window broken for all 32 of its checks', () => {
    const w = world();
    const id = createRide(w, RideType.Twist, 4, 4);
    const slot = slotOf(w, id);
    breakRide(w, slot, BreakdownReason.SafetyCutOut);
    for (let i = 0; i < RCT2_DOWNTIME_WINDOW_TICKS / RELIABILITY_CHECK_TICKS - 1; i++) runCheck(w);
    crossWindow(w);
    expect(getRideDowntimePercent(w, id)).toBe(16);
  });

  it('caps at 100 once eight windows are fully broken', () => {
    const w = world();
    const id = createRide(w, RideType.Twist, 4, 4);
    breakRide(w, slotOf(w, id), BreakdownReason.SafetyCutOut);
    for (let i = 0; i < 9 * (RCT2_DOWNTIME_WINDOW_TICKS / RELIABILITY_CHECK_TICKS); i++) {
      runCheck(w);
    }
    expect(getRideDowntimePercent(w, id)).toBe(100);
  });

  it('remembers a breakdown for eight windows and then forgets it', () => {
    const w = world();
    const id = createRide(w, RideType.Twist, 4, 4);
    brokenFor(w, id, 16);
    const readings: number[] = [];
    for (let window = 0; window < 10; window++) {
      crossWindow(w);
      readings.push(getRideDowntimePercent(w, id));
    }
    expect(readings).toEqual([8, 8, 8, 8, 8, 8, 8, 8, 0, 0]);
  });

  it('does not count a working ride', () => {
    const w = world();
    const id = openRide(w, RideType.Twist);
    setReliability(w, id, RELIABILITY_MAX);
    for (let i = 0; i < 64; i++) {
      w.rides.cols.reliabilityRaw[slotOf(w, id)] = RELIABILITY_MAX;
      runCheck(w);
    }
    crossWindow(w);
    expect(getRideDowntimePercent(w, id)).toBe(0);
  });

  it('averages over every ride, shops included', () => {
    const w = world();
    const broken = createRide(w, RideType.Twist, 4, 4);
    createRide(w, RideType.FoodStall, 8, 8);
    brokenFor(w, broken, 16);
    crossWindow(w);
    expect(getAverageRideDowntimePercent(w)).toBe(4);
  });

  it('reports no downtime for a park without rides', () => {
    expect(getAverageRideDowntimePercent(world())).toBe(0);
  });
});

describe('inspection schedule', () => {
  it('flags a ride a full interval after its last inspection', () => {
    const w = world();
    const id = createRide(w, RideType.Twist, 4, 4);
    expect(setRideInspectionInterval(w, id, 10)).toBe(true);
    w.tick = 10 * RCT2_INSPECTION_MINUTE_TICKS - 1;
    expect(isRideInspectionDue(w, id)).toBe(false);
    w.tick = 10 * RCT2_INSPECTION_MINUTE_TICKS;
    expect(isRideInspectionDue(w, id)).toBe(true);
  });

  it('never flags a ride set to never inspect', () => {
    const w = world();
    const id = createRide(w, RideType.Twist, 4, 4);
    setRideInspectionInterval(w, id, 0);
    w.tick = 10_000_000;
    expect(isRideInspectionDue(w, id)).toBe(false);
  });

  it('does not flag a ride that is already broken down', () => {
    const w = world();
    const id = openRide(w, RideType.Twist);
    setRideInspectionInterval(w, id, 10);
    breakRide(w, slotOf(w, id), BreakdownReason.SafetyCutOut);
    w.tick = 30 * RCT2_INSPECTION_MINUTE_TICKS;
    expect(isRideInspectionDue(w, id)).toBe(false);
  });
});

describe('repair reliability gain', () => {
  function repaired(reliabilityRaw: number): number {
    const w = world();
    const id = openRide(w, RideType.Twist);
    breakRide(w, slotOf(w, id), BreakdownReason.SafetyCutOut);
    setReliability(w, id, reliabilityRaw);
    expect(spawnStaff(w, StaffKind.Mechanic)).toBe(true);
    const mechanic = w.staff.slotToId[w.staff.count - 1];
    let done = false;
    for (let i = 0; i < 1_000 && !done; i++) {
      w.tick++;
      done = serviceRide(w, id, mechanic);
    }
    expect(done).toBe(true);
    return getRideReliabilityRaw(w, id);
  }

  it('adds mechanic energy times half the missing percent', () => {
    // Staff energy is 96; at 50% the missing 50 points halve to 25, and 96 * 25 = 2400.
    expect(repaired(50 * 256)).toBe(50 * 256 + 2_400);
    expect(repaired(0)).toBe(96 * 50);
  });

  it('rounds the missing half down, so a ride at 99% gains nothing', () => {
    expect(repaired(99 * 256)).toBe(99 * 256);
    expect(repaired(98 * 256)).toBe(98 * 256 + 96);
  });
});
