import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { World } from '../sim/core/world';
import { OWNED } from '../sim/map/tile-map';
import type { TileMap } from '../sim/map/tile-map';
import { SCENARIOS } from '../sim/scenario/catalog';
import { prepareScenarioPark } from '../sim/scenario/scenario-layout';
import { deserialize, serialize } from './save';

/** A Copper Ridge park saved by the game before the hard-park remix: an inset owned rectangle. */
function legacySave(): Uint8Array {
  return new Uint8Array(
    gunzipSync(
      readFileSync(new URL('./fixtures/copper-ridge-pre-remix.ocsave.gz', import.meta.url)),
    ),
  );
}

function ownedBox(m: TileMap): { count: number; area: number } {
  let count = 0;
  let x0 = m.width;
  let y0 = m.height;
  let x1 = -1;
  let y1 = -1;
  for (let i = 0; i < m.width * m.height; i++) {
    if (!(m.ownership[i] & OWNED)) continue;
    count++;
    const x = i % m.width;
    const y = Math.floor(i / m.width);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { count, area: (x1 - x0 + 1) * (y1 - y0 + 1) };
}

describe('saves from before the hard-park remix', () => {
  it('load with their own rectangular land and rules, not the remixed map', () => {
    const loaded = deserialize(legacySave());
    const box = ownedBox(loaded.map);
    expect(box.count).toBe(box.area);
    expect(loaded.scenario.restrictions).toEqual({});

    const def = SCENARIOS.find((s) => s.id === 'copper-ridge')!;
    const remix = new World({ seed: def.seed, width: def.mapWidth, height: def.mapHeight });
    prepareScenarioPark(remix, def);
    expect(ownedBox(remix.map).count).toBeLessThan(box.count / 2);
  });

  it('keep their land, terrain and scenery through another save', () => {
    const loaded = deserialize(legacySave());
    const again = deserialize(serialize(loaded));
    expect(Array.from(again.map.ownership)).toEqual(Array.from(loaded.map.ownership));
    expect(Array.from(again.map.vertexHeights)).toEqual(Array.from(loaded.map.vertexHeights));
    expect(Array.from(again.map.elData)).toEqual(Array.from(loaded.map.elData));
  });
});
