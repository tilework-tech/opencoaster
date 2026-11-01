import { describe, expect, it } from 'vitest';
import { TRACK_STEPS_PER_LEVEL } from '../core/constants';
import { FeedbackDomain } from '../core/feedback';
import { Simulation } from '../core/simulation';
import type { Command } from '../core/commands';
import { EconomyResult } from '../economy/actions';
import { CAMPAIGNS } from '../economy/marketing';
import { applyArea, planArea } from '../map/area-tools';
import { setTileHeight } from '../map/land';
import { applyLand, LandAction, LandResult, planLand } from '../map/land-tool';
import { previewPathRun, previewScenery } from '../map/map-commands';
import { PathResult } from '../map/paths';
import { placeScenery, SceneryItem, SceneryResult } from '../map/scenery';
import { ElementType, OWNED, SALE_LAND } from '../map/tile-map';
import { RideResult } from '../rides/ride-results';
import { RideType } from '../rides/ride-types';
import { pieceByName } from '../track/catalog';
import { PieceMode, TrackResult } from '../track/track-types';
import { applyScenario } from './scenario';
import { parseScenarioFile } from './scenario-file';

const SIZE = 32;
const GROUND = 4;

/** A flat owned park with the given rules; `shape` edits the land before the rules apply. */
function park(
  restrictions?: Record<string, unknown>,
  ground = GROUND,
  shape: (s: Simulation) => void = () => {},
): Simulation {
  const s = new Simulation({ seed: 3, width: SIZE, height: SIZE, maxGuests: 10 });
  s.world.map.waterLevel.fill(0);
  s.world.map.fillFlat(ground);
  s.world.map.ownership.fill(OWNED);
  s.world.economy.cash = 100_000_000;
  shape(s);
  const def = parseScenarioFile({
    id: 'rules-park',
    name: 'Rules Park',
    seed: 7,
    map: { width: SIZE, height: SIZE },
    finance: {
      startingCash: 100_000_000,
      startingLoan: 0,
      maxLoan: 0,
      annualInterestBps: 0,
    },
    pricing: { mode: 'admission' },
    research: {
      availableItemIds: [
        RideType.MerryGoRound,
        RideType.FoodStall,
        RideType.WoodenCoaster,
        RideType.ObservationTower,
      ],
    },
    objective: { kind: 'haveFun' },
    ...(restrictions === undefined ? {} : { restrictions }),
  });
  applyScenario(s.world, def);
  return s;
}

function run(s: Simulation, command: Command): void {
  s.enqueue(command);
  s.applyPendingCommands();
}

function sceneryAt(s: Simulation, x: number, y: number): SceneryItem[] {
  const m = s.world.map;
  const items: SceneryItem[] = [];
  for (let e = m.firstElement(m.index(x, y)); e >= 0; e = m.nextElement(e))
    if (m.elType[e] === ElementType.SmallScenery) items.push(m.elData[e] as SceneryItem);
  return items;
}

function feedback(s: Simulation): [FeedbackDomain, number] {
  return [s.world.feedback.domain, s.world.feedback.code];
}

/** Cash, heights, water and surface: what a refused command must leave alone. */
function fingerprint(s: Simulation): string {
  const m = s.world.map;
  return JSON.stringify([
    s.world.economy.cash,
    Array.from(m.heights),
    Array.from(m.vertexHeights),
    Array.from(m.waterLevel),
    Array.from(m.surface),
    Array.from(m.terrain),
    s.world.rides.count,
    s.world.track.pieces.count,
  ]);
}

describe('tree preservation', () => {
  it('refuses removing a tree but still removes other scenery', () => {
    const s = park({ forbidTreeRemoval: true });
    placeScenery(s.world.map, 5, 5, SceneryItem.OakTree);
    placeScenery(s.world.map, 6, 5, SceneryItem.Boulder);
    const before = s.world.economy.cash;

    run(s, { type: 'removeScenery', x: 5, y: 5 });
    expect(sceneryAt(s, 5, 5)).toEqual([SceneryItem.OakTree]);
    expect(s.world.economy.cash).toBe(before);
    expect(feedback(s)).toEqual([FeedbackDomain.Clear, LandResult.TreesProtected]);

    run(s, { type: 'removeScenery', x: 6, y: 5 });
    expect(sceneryAt(s, 6, 5)).toEqual([]);
  });

  it('lets the Clear tool take everything except the trees', () => {
    const s = park({ forbidTreeRemoval: true });
    placeScenery(s.world.map, 5, 5, SceneryItem.PalmTree);
    placeScenery(s.world.map, 6, 5, SceneryItem.Shrub);
    const square = { x: 4, y: 4, width: 4, height: 4 };

    expect(planArea(s.world, { tool: 'clear', ...square }).removed).toBe(1);
    run(s, { type: 'clearScenery', ...square });
    expect(sceneryAt(s, 5, 5)).toEqual([SceneryItem.PalmTree]);
    expect(sceneryAt(s, 6, 5)).toEqual([]);
  });

  it('refuses a Clear sweep over only trees', () => {
    const s = park({ forbidTreeRemoval: true });
    placeScenery(s.world.map, 5, 5, SceneryItem.Conifer);
    const square = { x: 5, y: 5, width: 1, height: 1 };
    const before = fingerprint(s);

    expect(planArea(s.world, { tool: 'clear', ...square }).result).toBe(LandResult.TreesProtected);
    run(s, { type: 'clearScenery', ...square });
    expect(sceneryAt(s, 5, 5)).toEqual([SceneryItem.Conifer]);
    expect(fingerprint(s)).toBe(before);
    expect(feedback(s)).toEqual([FeedbackDomain.Clear, LandResult.TreesProtected]);
  });

  it('refuses a land edit that would uproot a tree', () => {
    const s = park({ forbidTreeRemoval: true });
    placeScenery(s.world.map, 5, 5, SceneryItem.BirchTree);
    const before = fingerprint(s);

    run(s, { type: 'lowerLand', x: 5, y: 5, width: 1, height: 1 });
    expect(sceneryAt(s, 5, 5)).toEqual([SceneryItem.BirchTree]);
    expect(fingerprint(s)).toBe(before);
    expect(feedback(s)).toEqual([FeedbackDomain.Land, LandResult.TreesProtected]);

    run(s, { type: 'lowerLand', x: 9, y: 9, width: 1, height: 1 });
    expect(s.world.map.heights[s.world.map.index(9, 9)]).toBe(GROUND - 1);
  });

  it('lets an unrestricted land edit uproot a tree', () => {
    const s = park();
    placeScenery(s.world.map, 5, 5, SceneryItem.BirchTree);
    run(s, { type: 'lowerLand', x: 5, y: 5, width: 1, height: 1 });
    expect(sceneryAt(s, 5, 5)).toEqual([]);
  });

  it('removes trees normally in an unrestricted park', () => {
    const s = park();
    placeScenery(s.world.map, 5, 5, SceneryItem.OakTree);
    placeScenery(s.world.map, 7, 7, SceneryItem.OakTree);
    run(s, { type: 'removeScenery', x: 5, y: 5 });
    run(s, { type: 'clearScenery', x: 7, y: 7, width: 1, height: 1 });
    expect(sceneryAt(s, 5, 5)).toEqual([]);
    expect(sceneryAt(s, 7, 7)).toEqual([]);
  });
});

describe('landscaping ban', () => {
  const edits: Array<[string, Command, FeedbackDomain]> = [
    ['raise land', { type: 'raiseLand', x: 5, y: 5, width: 2, height: 2 }, FeedbackDomain.Land],
    ['lower land', { type: 'lowerLand', x: 5, y: 5, width: 2, height: 2 }, FeedbackDomain.Land],
    [
      'raise a corner',
      { type: 'raiseLand', x: 5, y: 5, width: 1, height: 1, corners: 1 },
      FeedbackDomain.Land,
    ],
    ['smooth land', { type: 'smoothLand', x: 5, y: 5, width: 3, height: 3 }, FeedbackDomain.Land],
    [
      'flatten land',
      { type: 'flattenLand', x: 5, y: 5, width: 3, height: 3, anchorX: 9, anchorY: 9 },
      FeedbackDomain.Land,
    ],
    ['set tile height', { type: 'setTileHeight', x: 5, y: 5, height: 9 }, FeedbackDomain.Land],
    [
      'raise water',
      { type: 'raiseWater', x: 13, y: 13, width: 1, height: 1 },
      FeedbackDomain.Water,
    ],
    [
      'lower water',
      { type: 'lowerWater', x: 13, y: 13, width: 1, height: 1 },
      FeedbackDomain.Water,
    ],
    [
      'set water',
      { type: 'setWater', x: 5, y: 5, width: 2, height: 2, level: 8 },
      FeedbackDomain.Water,
    ],
    [
      'paint land',
      { type: 'paintLand', x: 5, y: 5, width: 2, height: 2, surface: 1 },
      FeedbackDomain.Land,
    ],
  ];

  /** A bump at (6, 6) and a half-filled basin at (12..14, 12..14) give every tool work. */
  function terrain(s: Simulation): void {
    setTileHeight(s.world.map, 6, 6, GROUND + 2);
    for (let i = 0; i < 2; i++)
      applyLand(s.world, { action: LandAction.Lower, x: 12, y: 12, width: 3, height: 3 });
    applyArea(s.world, { tool: 'water', lower: false, x: 13, y: 13, width: 1, height: 1 });
  }

  it.each(edits)('refuses to %s and leaves the map and cash alone', (_name, command, domain) => {
    const s = park({ forbidLandscaping: true }, GROUND, terrain);
    const before = fingerprint(s);
    run(s, command);
    expect(fingerprint(s)).toBe(before);
    expect(feedback(s)).toEqual([domain, LandResult.LandscapingForbidden]);
  });

  it.each(edits)('lets an unrestricted park %s', (_name, command) => {
    const s = park(undefined, GROUND, terrain);
    const before = fingerprint(s);
    run(s, command);
    expect(fingerprint(s)).not.toBe(before);
  });

  it('shows the refusal in the land and water previews', () => {
    const s = park({ forbidLandscaping: true });
    expect(
      planLand(s.world, { action: LandAction.Raise, x: 5, y: 5, width: 1, height: 1 }).result,
    ).toBe(LandResult.LandscapingForbidden);
    expect(
      planArea(s.world, { tool: 'water', lower: false, x: 5, y: 5, width: 1, height: 1 }).result,
    ).toBe(LandResult.LandscapingForbidden);
  });

  it('still allows buying land', () => {
    const s = park({ forbidLandscaping: true });
    s.world.map.ownership[s.world.map.index(3, 3)] = SALE_LAND;
    run(s, { type: 'buyLand', x: 3, y: 3, width: 1, height: 1, rights: false });
    expect(s.world.map.ownership[s.world.map.index(3, 3)] & OWNED).toBe(OWNED);
  });
});

describe('construction height cap', () => {
  const CAP = 6;

  function placeFlat(s: Simulation, rideId: number, level: number): void {
    run(s, {
      type: 'placeTrack',
      rideId,
      pieceType: pieceByName('station')!.id,
      x: 10,
      y: 10,
      z: level * TRACK_STEPS_PER_LEVEL,
      dir: 0,
      mode: PieceMode.Normal,
    });
  }

  function coaster(s: Simulation): number {
    run(s, { type: 'createRide', rideType: RideType.WoodenCoaster, x: 10, y: 6 });
    return s.world.rides.slotToId[s.world.rides.count - 1];
  }

  it('refuses track higher than the cap above the ground and keeps cash', () => {
    const s = park({ maxConstructionHeight: CAP });
    const ride = coaster(s);
    const before = fingerprint(s);
    placeFlat(s, ride, GROUND + CAP + 1);
    expect(fingerprint(s)).toBe(before);
    expect(feedback(s)).toEqual([FeedbackDomain.Track, TrackResult.HeightLimit]);

    placeFlat(s, ride, GROUND + CAP);
    expect(s.world.track.pieces.count).toBe(1);
  });

  it('measures from the local ground, so a mountain park can still build', () => {
    const high = 20;
    const s = park({ maxConstructionHeight: CAP }, high);
    const ride = coaster(s);
    placeFlat(s, ride, high + 2);
    expect(s.world.track.pieces.count).toBe(1);
  });

  it('refuses an Observation Tower taller than the cap, at build and when raised', () => {
    const s = park({ maxConstructionHeight: 10 });
    const before = fingerprint(s);
    run(s, {
      type: 'createRide',
      rideType: RideType.ObservationTower,
      x: 8,
      y: 8,
      towerHeight: 11,
    });
    expect(fingerprint(s)).toBe(before);
    expect(feedback(s)).toEqual([FeedbackDomain.Ride, RideResult.HeightLimit]);

    run(s, { type: 'createRide', rideType: RideType.ObservationTower, x: 8, y: 8, towerHeight: 9 });
    expect(s.world.rides.count).toBe(1);
    const tower = s.world.rides.slotToId[0];
    const height = () => s.world.rides.cols.towerHeight[s.world.rides.idToSlot[tower]];
    run(s, { type: 'setObservationTowerHeight', rideId: tower, height: 12 });
    expect(height()).toBe(9);
    expect(feedback(s)).toEqual([FeedbackDomain.Ride, RideResult.HeightLimit]);
    run(s, { type: 'setObservationTowerHeight', rideId: tower, height: 8 });
    expect(height()).toBe(8);
  });

  it('allows ordinary flat rides and stalls on the ground, even on a slope', () => {
    const s = park({ maxConstructionHeight: 4 }, GROUND, (p) =>
      applyLand(p.world, {
        action: LandAction.Raise,
        x: 14,
        y: 14,
        width: 1,
        height: 1,
        corners: 1,
      }),
    );
    expect(s.world.map.slope[s.world.map.index(14, 14)]).not.toBe(0);
    run(s, { type: 'createRide', rideType: RideType.FoodStall, x: 14, y: 14 });
    run(s, { type: 'createRide', rideType: RideType.MerryGoRound, x: 4, y: 20 });
    expect(s.world.rides.count).toBe(2);
  });

  it('refuses a raised footpath above the cap and allows one below it', () => {
    const s = park({ maxConstructionHeight: CAP });
    const high = [{ x: 3, y: 3, z: GROUND + CAP + 1 }];
    expect(previewPathRun(s.world, high)[0].result).toBe(PathResult.HeightLimit);
    const before = fingerprint(s);
    run(s, { type: 'placePath', ...high[0] });
    expect(fingerprint(s)).toBe(before);
    expect(s.world.map.pathElement(s.world.map.index(3, 3), -1)).toBe(-1);
    expect(feedback(s)).toEqual([FeedbackDomain.Path, PathResult.HeightLimit]);

    run(s, { type: 'placePath', x: 3, y: 3, z: GROUND + CAP });
    run(s, { type: 'placePath', x: 4, y: 3 });
    expect(s.world.map.pathElement(s.world.map.index(3, 3), -1)).toBeGreaterThanOrEqual(0);
    expect(s.world.map.pathElement(s.world.map.index(4, 3), -1)).toBeGreaterThanOrEqual(0);
  });

  it('refuses scenery taller than the cap and keeps shorter scenery', () => {
    const s = park({ maxConstructionHeight: 4 });
    expect(previewScenery(s.world, { x: 5, y: 5, item: SceneryItem.Flagpole, rotation: 0 })).toBe(
      SceneryResult.HeightLimit,
    );
    run(s, { type: 'placeScenery', x: 5, y: 5, item: SceneryItem.Flagpole });
    expect(sceneryAt(s, 5, 5)).toEqual([]);
    run(s, { type: 'placeScenery', x: 6, y: 6, item: SceneryItem.Shrub });
    expect(sceneryAt(s, 6, 6)).toEqual([SceneryItem.Shrub]);
  });

  it('measures over water from the water surface', () => {
    const s = park({ maxConstructionHeight: CAP }, GROUND, (p) => {
      for (let i = 0; i < 3; i++)
        applyLand(p.world, { action: LandAction.Lower, x: 9, y: 9, width: 3, height: 3 });
      for (let i = 0; i < 2; i++)
        applyArea(p.world, { tool: 'water', lower: false, x: 10, y: 10, width: 1, height: 1 });
    });
    const tile = s.world.map.index(10, 10);
    const surface = s.world.map.waterLevel[tile];
    expect(surface).toBeGreaterThan(s.world.map.heights[tile]);
    expect(previewPathRun(s.world, [{ x: 10, y: 10, z: surface + CAP }])[0].result).not.toBe(
      PathResult.HeightLimit,
    );
    expect(previewPathRun(s.world, [{ x: 10, y: 10, z: surface + CAP + 1 }])[0].result).toBe(
      PathResult.HeightLimit,
    );
  });

  it('places the same tall structures in an unrestricted park', () => {
    const s = park();
    const ride = coaster(s);
    placeFlat(s, ride, GROUND + CAP + 4);
    run(s, { type: 'placePath', x: 3, y: 3, z: GROUND + CAP + 4 });
    expect(s.world.track.pieces.count).toBe(1);
    expect(s.world.map.pathElement(s.world.map.index(3, 3), -1)).toBeGreaterThanOrEqual(0);
  });
});

describe('forbidden ride types', () => {
  it('refuses building a forbidden type even when something unlocked it', () => {
    const s = park({ forbiddenRideTypeIds: [RideType.TopSpin] });
    // A scenario file cannot unlock a forbidden type; this stands in for a save edited by hand.
    s.world.research.unlocked.add(RideType.TopSpin);
    const before = fingerprint(s);
    run(s, { type: 'createRide', rideType: RideType.TopSpin, x: 8, y: 8 });
    expect(fingerprint(s)).toBe(before);
    expect(feedback(s)).toEqual([FeedbackDomain.Ride, RideResult.RideTypeForbidden]);

    run(s, { type: 'createRide', rideType: RideType.MerryGoRound, x: 8, y: 8 });
    expect(s.world.rides.count).toBe(1);
  });
});

describe('marketing ban', () => {
  it.each(CAMPAIGNS.map((_, id) => id))('refuses campaign %i and charges nothing', (campaignId) => {
    const s = park({ forbidMarketing: true });
    run(s, { type: 'createRide', rideType: RideType.FoodStall, x: 8, y: 8 });
    const target = s.world.rides.slotToId[0];
    const before = fingerprint(s);
    run(s, {
      type: 'economy',
      action: { type: 'startCampaign', campaignId, weeks: 2, targetId: target },
    });
    expect(fingerprint(s)).toBe(before);
    expect(s.world.economy.campaignWeeksLeft).toBe(0);
    expect(feedback(s)).toEqual([FeedbackDomain.Economy, EconomyResult.MarketingForbidden]);
  });

  it('runs campaigns in an unrestricted park', () => {
    const s = park();
    run(s, { type: 'economy', action: { type: 'startCampaign', campaignId: 0, weeks: 2 } });
    expect(s.world.economy.campaignWeeksLeft).toBe(2);
  });
});
