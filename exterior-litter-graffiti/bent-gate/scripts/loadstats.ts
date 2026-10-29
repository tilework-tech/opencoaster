import { readFileSync } from 'node:fs';
import { deserialize } from '../../src/save/save';
import { ElementType, isPathElementBroken } from '../../src/sim/map/tile-map';
const w = deserialize(new Uint8Array(readFileSync(process.env.SAVE!)));
const m = w.map;
let out = 0, inn = 0, bend = 0;
for (let i = 0; i < w.litter.count; i++) { const x = w.litter.cols.x[i]! >> 8, y = w.litter.cols.y[i]! >> 8;
  if ((x === 63 && y >= 94) || (x === 64 && y === 94)) { out++; if (y === 94) bend++; } else inn++; }
const counts: Record<number, number> = {}; const broken: string[] = [];
for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) for (let e = m.firstElement(m.index(x, y)); e >= 0; e = m.nextElement(e)) {
  counts[m.elType[e]!] = (counts[m.elType[e]!] ?? 0) + 1;
  if (m.elType[e] === ElementType.Path && isPathElementBroken(m, e)) broken.push(`${x},${y}`);
}
console.log(JSON.stringify({ litterOutsideRoute: out, litterOnBendAndGate: bend, litterInterior: inn, elementCountsByType: counts, brokenPathAdditions: broken, gate: [w.park.entranceX, w.park.entranceY] }));
