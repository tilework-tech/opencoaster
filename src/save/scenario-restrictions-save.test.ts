import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim/core/simulation';
import { placeScenery, SceneryItem } from '../sim/map/scenery';
import { ElementType, OWNED } from '../sim/map/tile-map';
import { applyScenario } from '../sim/scenario/scenario';
import { parseScenarioFile } from '../sim/scenario/scenario-file';
import { deserialize, serialize } from './save';

function restrictedPark(): Simulation {
  const s = new Simulation({ seed: 5, width: 24, height: 24, maxGuests: 10 });
  s.world.map.waterLevel.fill(0);
  s.world.map.fillFlat(4);
  s.world.map.ownership.fill(OWNED);
  applyScenario(
    s.world,
    parseScenarioFile({
      id: 'saved-rules',
      name: 'Saved Rules',
      seed: 1,
      map: { width: 24, height: 24 },
      finance: { startingCash: 1_000_000, startingLoan: 0, maxLoan: 0, annualInterestBps: 0 },
      pricing: { mode: 'admission' },
      objective: { kind: 'haveFun' },
      restrictions: { forbidTreeRemoval: true, maxConstructionHeight: 5, forbidMarketing: true },
    }),
  );
  placeScenery(s.world.map, 3, 3, SceneryItem.OakTree);
  return s;
}

/** The save as a build from before restrictions existed would have written it. */
function withoutSavedRestrictions(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerEnd = 8 + view.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, headerEnd)));
  delete header.scenario.restrictions;
  const encoded = new TextEncoder().encode(JSON.stringify(header));
  const result = new Uint8Array(8 + encoded.length + bytes.length - headerEnd);
  result.set(bytes.subarray(0, 8));
  new DataView(result.buffer).setUint32(4, encoded.length, true);
  result.set(encoded, 8);
  result.set(bytes.subarray(headerEnd), 8 + encoded.length);
  return result;
}

function hasTree(s: Simulation): boolean {
  const m = s.world.map;
  for (let e = m.firstElement(m.index(3, 3)); e >= 0; e = m.nextElement(e))
    if (m.elType[e] === ElementType.SmallScenery) return true;
  return false;
}

function tryRemoveTreeAndAdvertise(s: Simulation): void {
  s.enqueue({ type: 'removeScenery', x: 3, y: 3 });
  s.enqueue({ type: 'economy', action: { type: 'startCampaign', campaignId: 0, weeks: 1 } });
  s.applyPendingCommands();
}

describe('saved scenario restrictions', () => {
  it('keeps enforcing the rules the park started with after a save and load', () => {
    const loaded = new Simulation(deserialize(serialize(restrictedPark().world)));
    expect(loaded.world.scenario.restrictions).toEqual({
      forbidTreeRemoval: true,
      maxConstructionHeight: 5,
      forbidMarketing: true,
    });
    tryRemoveTreeAndAdvertise(loaded);
    expect(hasTree(loaded)).toBe(true);
    expect(loaded.world.economy.campaignWeeksLeft).toBe(0);
  });

  it('loads a save without recorded rules as unrestricted', () => {
    const old = withoutSavedRestrictions(serialize(restrictedPark().world));
    const loaded = new Simulation(deserialize(old));
    tryRemoveTreeAndAdvertise(loaded);
    expect(hasTree(loaded)).toBe(false);
    expect(loaded.world.economy.campaignWeeksLeft).toBe(1);
  });
});
