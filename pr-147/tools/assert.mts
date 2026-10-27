import sharp from 'sharp';
import { readdirSync } from 'node:fs';
let bad = 0, n = 0;
for (const dir of process.argv.slice(2)) for (const f of readdirSync(dir).filter((x) => x.endsWith('.png'))) {
  const { data, info } = await sharp(`${dir}/${f}`).extract({ left: 440, top: 100, width: 400, height: 360 }).raw().toBuffer({ resolveWithObject: true });
  let hull = 0, frame = 0;
  for (let i = 0; i < data.length; i += info.channels) { const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
    if (r > 120 && g < 90 && b < 90) hull++; if (r > 170 && g > 170 && b > 170 && Math.abs(r - b) < 40) frame++; }
  n++; if (hull < 150 || frame < 100) { bad++; console.log('NO SHIP', dir, f, hull, frame); }
}
console.log(n, 'frames checked,', bad, 'missing');
