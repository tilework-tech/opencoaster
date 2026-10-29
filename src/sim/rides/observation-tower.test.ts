import { RidePhase } from './ride-store';
import {
  DEFAULT_TOWER_HEIGHT,
  MAX_TOWER_HEIGHT,
  MIN_TOWER_HEIGHT,
  TOWER_SECTION_COST,
  observationTowerCabinLevel,
  observationTowerRunTicks,
} from './observation-tower';
import { flatOwnedSim } from './coaster-fixtures';
import { RIDE_CATALOG, RideType } from './ride-types';
import { createRide, setObservationTowerHeight } from './ride-operations';
import { worldOccupancies } from '../map/occupancy';
import { RideResult } from './ride-results';
import { RideState } from './ride-store';
import { rideSystem } from './ride-system';
import { Z_STEP } from '../core/constants';
import { serialize, deserialize, SAVE_VERSION } from '../../save/save';
import { allWorldViews, withoutColumns } from '../../save/legacy-save-fixtures';
import { BreakdownReason, breakRide, repairTicksFor, serviceRide } from './ride-maintenance';
import { spawnStaff, StaffKind } from '../staff/staff-store';
import { ElementType } from '../map/tile-map';

describe('Observation Tower travel', () => {
  it('preserves the historical height as the new default and enforces a practical range', () => {
    expect(DEFAULT_TOWER_HEIGHT).toBe(11);
    expect(MIN_TOWER_HEIGHT).toBe(4);
    expect(MAX_TOWER_HEIGHT).toBeGreaterThan(DEFAULT_TOWER_HEIGHT);
  });

  it('takes longer to travel a taller tower without compressing its speed', () => {
    const short = observationTowerRunTicks(MIN_TOWER_HEIGHT);
    const medium = observationTowerRunTicks(12);
    const tall = observationTowerRunTicks(MAX_TOWER_HEIGHT);

    expect(medium).toBeGreaterThan(short);
    expect(tall).toBeGreaterThan(medium);
    expect((medium - short) / (12 - MIN_TOWER_HEIGHT)).toBe(
      (tall - medium) / (MAX_TOWER_HEIGHT - 12),
    );
    expect(migrated.rides.cols.runTicks[migrated.rides.idToSlot[rideId]]).toBe(
      observationTowerRunTicks(DEFAULT_TOWER_HEIGHT),
    );
  });

  it('moves gently up, pauses at the view, then returns before unloading', () => {
    const height = 12;
    const at = (progress: number) =>
      observationTowerCabinLevel(height, RidePhase.Running, progress);

    expect(at(0)).toBeCloseTo(0.5);
    expect(at(450)).toBeCloseTo(height - 1);
    expect(at(500)).toBeCloseTo(height - 1);
    expect(at(1000)).toBeCloseTo(0.5);
    expect(
      observationTowerCabinLevel(height, RidePhase.Unloading, 0),
    ).toBeCloseTo(0.5);
  });

  it('lets a closed tower change height and charges or refunds for its vertical sections', () => {
    const sim = flatOwnedSim();
    const rideId = createRide(sim.world, RideType.ObservationTower, 20, 20);
    const slot = sim.world.rides.idToSlot[rideId]!;
    const initialCash = sim.world.economy.cash;

    expect(setObservationTowerHeight(sim.world, rideId, 14)).toBe(RideResult.Ok);
    expect(sim.world.rides.cols.towerHeight[slot]).toBe(14);
    expect(sim.world.rides.cols.runTicks[slot]).toBe(observationTowerRunTicks(14));
    expect(sim.world.economy.cash).toBe(initialCash - 3 * TOWER_SECTION_COST);

    expect(setObservationTowerHeight(sim.world, rideId, 12)).toBe(RideResult.Ok);
    expect(sim.world.rides.cols.towerHeight[slot]).toBe(12);
    expect(sim.world.economy.cash).toBe(
      initialCash - 3 * TOWER_SECTION_COST + Math.floor((2 * TOWER_SECTION_COST * 70) / 100),
    );
  });

  it('blocks resizing into a vertical obstruction while allowing a shorter clearance', () => {
    const sim = flatOwnedSim();
    const rideId = createRide(sim.world, RideType.ObservationTower, 20, 20);
    const tile = sim.world.map.index(20, 20);
    sim.world.map.addElement(tile, ElementType.Wall, 12, 14, 0, 0);

    expect(setObservationTowerHeight(sim.world, rideId, 20)).toBe(RideResult.Blocked);
    expect(sim.world.rides.cols.towerHeight[sim.world.rides.idToSlot[rideId]!]).toBe(
      DEFAULT_TOWER_HEIGHT,
    );
    expect(setObservationTowerHeight(sim.world, rideId, 10)).toBe(RideResult.Ok);
  });

  it('builds a selected-height tower with matching cost, clearance and travel time', () => {
    const sim = flatOwnedSim();
    sim.world.research.unlocked.add(RideType.ObservationTower);
    const initialCash = sim.world.economy.cash;
    sim.enqueue({
      type: 'createRide',
      rideType: RideType.ObservationTower,
      x: 20,
      y: 20,
      towerHeight: 20,
    });
    sim.step();

    const rideId = sim.world.rides.slotToId[0]!;
    const slot = sim.world.rides.idToSlot[rideId]!;
    const tower = worldOccupancies(sim.world).find((volume) => volume.name === 'Observation Tower 1');
    expect(sim.world.rides.cols.towerHeight[slot]).toBe(20);
    expect(sim.world.rides.cols.runTicks[slot]).toBe(observationTowerRunTicks(20));
    expect(sim.world.economy.cash).toBe(
      initialCash -
        RIDE_CATALOG[RideType.ObservationTower].cost -
        (20 - DEFAULT_TOWER_HEIGHT) * TOWER_SECTION_COST,
    );
    expect(tower?.clearance).toBe(tower!.base + 20 * Z_STEP);
  });

  it('does not enter unloading until the entire distance-based run has elapsed', () => {
    const sim = flatOwnedSim();
    const rideId = createRide(sim.world, RideType.ObservationTower, 20, 20);
    const slot = sim.world.rides.idToSlot[rideId]!;
    expect(setObservationTowerHeight(sim.world, rideId, 20)).toBe(RideResult.Ok);
    sim.world.rides.state[slot] = RideState.Open;
    sim.world.rides.phase[slot] = RidePhase.Running;
    sim.world.rides.phaseTicks[slot] = sim.world.rides.runTicks[slot];

    for (let tick = 0; tick < sim.world.rides.runTicks[slot] - 1; tick++) {
      rideSystem.update(sim.world);
      sim.world.tick++;
      expect(sim.world.rides.phase[slot]).toBe(RidePhase.Running);
    }
    rideSystem.update(sim.world);
    expect(sim.world.rides.phase[slot]).toBe(RidePhase.Unloading);
  });

  it('keeps riders aboard through a breakdown and returns the cabin before unloading them', () => {
    const sim = flatOwnedSim();
    const rideId = createRide(sim.world, RideType.ObservationTower, 20, 20);
    const slot = sim.world.rides.idToSlot[rideId]!;
    setObservationTowerHeight(sim.world, rideId, 12);
    sim.world.rides.cols.state[slot] = RideState.Open;
    sim.world.rides.cols.phase[slot] = RidePhase.Running;
    sim.world.rides.cols.phaseTicks[slot] = Math.floor(sim.world.rides.cols.runTicks[slot] / 2);
    sim.world.rides.cols.boarded[slot] = 4;

    breakRide(sim.world, slot, BreakdownReason.SafetyCutOut);
    const strandedLevel = sim.world.rides.cols.phaseTicks[slot] / 1_000;
    expect(strandedLevel).toBeGreaterThan(0.5);
    expect(sim.world.rides.cols.boarded[slot]).toBe(4);
    rideSystem.update(sim.world);
    expect(sim.world.rides.cols.boarded[slot]).toBe(4);

    expect(spawnStaff(sim.world, StaffKind.Mechanic)).toBe(true);
    const mechanic = sim.world.staff.slotToId[sim.world.staff.count - 1]!;
    for (let tick = 0; tick < repairTicksFor(BreakdownReason.SafetyCutOut); tick++) {
      sim.world.tick++;
      serviceRide(sim.world, rideId, mechanic);
    }
    expect(sim.world.rides.cols.phase[slot]).toBe(RidePhase.Unloading);

    const returnTicks = sim.world.rides.cols.phaseTicks[slot] - sim.world.rides.cols.unloadTicks[slot];
    for (let tick = 0; tick < returnTicks - 1; tick++) {
      rideSystem.update(sim.world);
      sim.world.tick++;
      expect(sim.world.rides.cols.boarded[slot]).toBe(4);
    }
    expect(sim.world.rides.cols.phaseTicks[slot]).toBeGreaterThan(
      sim.world.rides.cols.unloadTicks[slot],
    );
    expect(sim.world.rides.cols.boarded[slot]).toBe(4);
    rideSystem.update(sim.world);
    expect(sim.world.rides.cols.phaseTicks[slot]).toBe(sim.world.rides.cols.unloadTicks[slot]);
    expect(sim.world.rides.cols.boarded[slot]).toBe(4);
    for (let tick = 0; tick < sim.world.rides.cols.unloadTicks[slot]; tick++)
      rideSystem.update(sim.world);
    expect(sim.world.rides.cols.boarded[slot]).toBe(0);
  });

  it('rejects heights outside the range and edits while the ride is open', () => {
    const sim = flatOwnedSim();
    const rideId = createRide(sim.world, RideType.ObservationTower, 20, 20);
    const slot = sim.world.rides.idToSlot[rideId]!;

    expect(setObservationTowerHeight(sim.world, rideId, MIN_TOWER_HEIGHT - 1)).toBe(
      RideResult.Blocked,
    );
    expect(setObservationTowerHeight(sim.world, rideId, MAX_TOWER_HEIGHT + 1)).toBe(
      RideResult.Blocked,
    );
    sim.world.rides.cols.state[slot] = RideState.Open;
    expect(setObservationTowerHeight(sim.world, rideId, 12)).toBe(RideResult.Busy);
  });

  it('saves chosen heights and migrates v34 towers to their historical height', () => {
    const sim = flatOwnedSim();
    const rideId = createRide(sim.world, RideType.ObservationTower, 20, 20);
    const slot = sim.world.rides.idToSlot[rideId]!;
    expect(setObservationTowerHeight(sim.world, rideId, 18)).toBe(RideResult.Ok);

    const current = deserialize(serialize(sim.world));
    expect(current.rides.cols.towerHeight[current.rides.idToSlot[rideId]]).toBe(18);
    expect(SAVE_VERSION).toBe(35);

    const legacy = withoutColumns(serialize(sim.world), 34, allWorldViews(sim.world), [
      sim.world.rides.cols.towerHeight,
    ]);
    const migrated = deserialize(legacy);
    expect(migrated.rides.cols.towerHeight[migrated.rides.idToSlot[rideId]]).toBe(
      DEFAULT_TOWER_HEIGHT,
    );
  });
});
