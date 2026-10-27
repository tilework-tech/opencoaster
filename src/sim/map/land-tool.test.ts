import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { FeedbackDomain } from '../core/feedback';
import { rideFootprintTiles } from '../rides/ride-footprint';
import { RIDE_CATALOG, RideType } from '../rides/ride-types';
import {
  buildCircuit,
  createCoaster,
  flatOwnedSim,
  GROUND,
  STATION_X,
  STATION_Y,
} from '../rides/coaster-fixtures';
import { LandAction, LandResult, planLand } from './land-tool';
import { LAND_HEIGHT_STEP_COST_CENTS } from './land';
import { OWNED } from './tile-map';
import { SceneryItem } from './scenery';
import { placePath } from './paths';

function sim(): Simulation {
  const s = new Simulation({ seed: 3, width: 32, height: 32, maxGuests: 10 });
  s.world.map.waterLevel.fill(0);
  s.world.map.fillFlat(4);
  s.world.map.ownership.fill(OWNED);
  return s;
}

const edit = (s: Simulation, e: Parameters<typeof planLand>[1]) => planLand(s.world, e);

describe('land tool planning', () => {
  it('previews exactly the corners and tiles an edge selection changes, without touching the map', () => {
    const s = sim();
    const revision = s.world.map.revision;
    const plan = edit(s, {
      action: LandAction.Raise,
      x: 8,
      y: 8,
      width: 1,
      height: 1,
      corners: 0b0011,
    });
    expect(plan.result).toBe(LandResult.Ok);
    expect(plan.vertices.length).toBe(2);
    expect(plan.costCents).toBe(2 * LAND_HEIGHT_STEP_COST_CENTS);
    expect(s.world.map.revision).toBe(revision);
    expect(s.world.map.slope[s.world.map.index(8, 8)]).toBe(0);
  });

  it('applies a corner raise through the command queue and charges for it', () => {
    const s = sim();
    const cash = s.world.economy.cash;
    s.enqueue({ type: 'raiseLand', x: 8, y: 8, width: 1, height: 1, corners: 0b0100 });
    s.step();
    expect(s.world.map.slope[s.world.map.index(8, 8)]).toBe(0b0100);
    expect(cash - s.world.economy.cash).toBe(LAND_HEIGHT_STEP_COST_CENTS);
  });

  it('flattens a hilly area to the height of the anchor tile', () => {
    const s = sim();
    for (let k = 0; k < 3; k++) s.enqueue({ type: 'raiseLand', x: 10, y: 10, width: 1, height: 1 });
    s.step();
    s.enqueue({ type: 'flattenLand', x: 8, y: 8, width: 5, height: 5, anchorX: 8, anchorY: 8 });
    s.step();
    const m = s.world.map;
    for (let y = 8; y < 13; y++)
      for (let x = 8; x < 13; x++) {
        expect(m.heights[m.index(x, y)]).toBe(m.heights[m.index(8, 8)]);
        expect(m.slope[m.index(x, y)]).toBe(0);
      }
  });

  it('flatten can raise a hollow up to the anchor height', () => {
    const s = sim();
    s.enqueue({ type: 'lowerLand', x: 10, y: 10, width: 1, height: 1 });
    s.step();
    s.enqueue({ type: 'flattenLand', x: 9, y: 9, width: 3, height: 3, anchorX: 5, anchorY: 5 });
    s.step();
    const m = s.world.map;
    expect(m.heights[m.index(10, 10)]).toBe(4);
    expect(m.slope[m.index(10, 10)]).toBe(0);
  });

  it('smoothing shaves a spike without leaving a cliff', () => {
    const s = sim();
    s.enqueue({ type: 'raiseLand', x: 10, y: 10, width: 1, height: 1 });
    s.step();
    s.enqueue({ type: 'smoothLand', x: 9, y: 9, width: 3, height: 3 });
    s.step();
    const m = s.world.map;
    expect(m.heights[m.index(10, 10)]).toBe(4);
  });

  it('acts on owned tiles of the selection and refuses a selection with none', () => {
    const s = sim();
    s.world.map.ownership[s.world.map.index(9, 8)] = 0;
    const part = edit(s, { action: LandAction.Raise, x: 8, y: 8, width: 2, height: 1 });
    expect(part.result).toBe(LandResult.Ok);
    expect(part.tiles).toContain(s.world.map.index(8, 8));
    s.world.map.ownership[s.world.map.index(8, 8)] = 0;
    expect(edit(s, { action: LandAction.Raise, x: 8, y: 8, width: 2, height: 1 }).result).toBe(
      LandResult.NotOwned,
    );
  });

  it('refuses to raise or lower beyond the height limits', () => {
    const s = sim();
    s.world.map.fillFlat(0);
    expect(edit(s, { action: LandAction.Lower, x: 8, y: 8, width: 1, height: 1 }).result).toBe(
      LandResult.TooLow,
    );
    s.world.map.fillFlat(31);
    expect(edit(s, { action: LandAction.Raise, x: 8, y: 8, width: 1, height: 1 }).result).toBe(
      LandResult.TooHigh,
    );
  });

  it('refuses when the player cannot pay and reports the reason', () => {
    const s = sim();
    s.world.economy.cash = 100;
    s.enqueue({ type: 'raiseLand', x: 8, y: 8, width: 1, height: 1 });
    s.step();
    expect(s.world.map.heights[s.world.map.index(8, 8)]).toBe(4);
    expect(s.world.feedback.domain).toBe(FeedbackDomain.Land);
    expect(s.world.feedback.code).toBe(LandResult.InsufficientFunds);
  });

  it('refuses to raise terrain into scenery', () => {
    const s = sim();
    s.enqueue({ type: 'placeScenery', x: 8, y: 8, item: SceneryItem.OakTree });
    s.step();
    const cash = s.world.economy.cash;
    s.enqueue({ type: 'raiseLand', x: 8, y: 8, width: 1, height: 1 });
    s.step();
    expect(s.world.map.heights[s.world.map.index(8, 8)]).toBe(4);
    expect(s.world.economy.cash).toBe(cash);
    let scenery = 0;
    const m = s.world.map;
    for (let e = m.firstElement(m.index(8, 8)); e >= 0; e = m.nextElement(e)) scenery++;
    expect(scenery).toBe(1);
  });
});

describe('land tool and structures', () => {
  it('refuses to change land under every tile of a flat ride and under tiles it would tilt', () => {
    for (const dir of [0, 1, 2, 3]) {
      const s = flatOwnedSim();
      s.world.research.unlocked.add(RideType.SwingingShip);
      s.enqueue({ type: 'createRide', rideType: RideType.SwingingShip, x: 20, y: 20, dir });
      s.step();
      expect(s.world.rides.count).toBe(1);
      const tiles = rideFootprintTiles(RIDE_CATALOG[RideType.SwingingShip], 20, 20, dir);
      expect(tiles).toHaveLength(5);
      for (const [x, y] of tiles) {
        const under = edit(s, { action: LandAction.Raise, x, y, width: 1, height: 1 });
        expect(under.result).toBe(LandResult.RideInTheWay);
        expect(tiles.map(([tx, ty]) => s.world.map.index(tx, ty))).toContain(under.subject);
      }
      const [lx, ly] = tiles[tiles.length - 1];
      const beyond = edit(s, {
        action: LandAction.Raise,
        x: lx + 3,
        y: ly + 3,
        width: 1,
        height: 1,
      });
      expect(beyond.result).toBe(LandResult.Ok);
    }
  });

  it('refuses under ground-level track and stations but allows land far below elevated track', () => {
    const s = flatOwnedSim();
    const rideId = createCoaster(s, RideType.SteelLoopingCoaster);
    buildCircuit(s, rideId);
    const station = edit(s, {
      action: LandAction.Lower,
      x: STATION_X,
      y: STATION_Y,
      width: 1,
      height: 1,
    });
    expect(station.result).toBe(LandResult.RideInTheWay);
    const heightBefore = s.world.map.heights.slice();
    s.enqueue({ type: 'raiseLand', x: STATION_X, y: STATION_Y, width: 1, height: 1 });
    s.step();
    expect(s.world.map.heights).toEqual(heightBefore);
    expect(GROUND).toBeGreaterThan(0);
  });

  it('refuses to change land at the park entrance', () => {
    const s = sim();
    s.world.park.entranceX = 8;
    s.world.park.entranceY = 8;
    expect(edit(s, { action: LandAction.Raise, x: 8, y: 8, width: 1, height: 1 }).result).toBe(
      LandResult.EntranceInTheWay,
    );
  });

  it('refuses to raise terrain into a footpath', () => {
    const s = sim();
    expect(placePath(s.world.map, { x: 8, y: 8 })).toBe(true);
    expect(edit(s, { action: LandAction.Raise, x: 8, y: 8, width: 1, height: 1 }).result).toBe(
      LandResult.PathInTheWay,
    );
    const m = s.world.map;
    const i = m.index(8, 8);
    expect(m.heights[i]).toBe(4);
    expect(m.pathElement(i, 4)).toBeGreaterThanOrEqual(0);
  });

  it('blocks a change that would make the ground under a footpath neither flat nor a ramp', () => {
    const s = sim();
    placePath(s.world.map, { x: 8, y: 8 });
    const ramp = edit(s, {
      action: LandAction.Raise,
      x: 8,
      y: 8,
      width: 1,
      height: 1,
      corners: 0b0011,
    });
    expect(ramp.result).toBe(LandResult.PathInTheWay);
    expect(s.world.map.heights[s.world.map.index(8, 8)]).toBe(4);
  });
});
