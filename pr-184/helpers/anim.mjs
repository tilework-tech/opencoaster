import sharp from 'sharp';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const [,, dir, out, delay] = process.argv;
const files = (await readdir(dir)).filter((f) => f.endsWith('.png')).sort();
const frames = await Promise.all(files.map((f) => sharp(join(dir, f)).resize({ width: 420, kernel: 'nearest' }).png().toBuffer()));
const gif = await sharp(frames, { join: { animated: true } }).gif({ delay: +delay, loop: 0 }).toBuffer();
await writeFile(out, gif);
console.log(out, gif.length, files.length);
