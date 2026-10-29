import { readFileSync } from 'node:fs';
import { deserialize, serialize, SAVE_VERSION } from '../../src/save/save';
import { SceneryCategory, SCENERY_CATALOG } from '../../src/sim/map/scenery';
import { ElementType } from '../../src/sim/map/tile-map';
const summarize = (w: ReturnType<typeof deserialize>) => ({
  trees: Array.from(w.map.elType).filter((t, i) => t === ElementType.SmallScenery && SCENERY_CATALOG[w.map.elData[i]]?.category === SceneryCategory.Trees).length,
  entrance: [w.park.entranceX, w.park.entranceY], spawns: w.park.spawns, litter: w.litter.count, guests: w.guests.count, tick: w.tick,
});
const bytes = new Uint8Array(readFileSync(process.argv[2]!));
const a = deserialize(bytes);
const out = serialize(a);
const hv = new DataView(out.buffer, out.byteOffset);
const hdr = JSON.parse(new TextDecoder().decode(out.subarray(8, 8 + hv.getUint32(4, true))));
const b = deserialize(out);
console.log(JSON.stringify({ SAVE_VERSION, reserializedVersion: hdr.version, loadedV34: summarize(a), reloadedV35: summarize(b) }, null, 1));
