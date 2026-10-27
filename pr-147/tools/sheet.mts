// usage: tsx sheet.mts <capDir> <outDir> <prefix> [cx cy w h]
import sharp from 'sharp';
import { readdirSync, mkdirSync } from 'node:fs';
const [dir, out, prefix, cx = '640', cy = '320', cw = '340', ch = '320'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const W = +cw, H = +ch, left = Math.round(+cx - W / 2), top = Math.round(+cy - H / 2);
const names = [...new Set(readdirSync(dir).filter((f) => /-r\d\.png$/.test(f) && !f.startsWith('c-')).map((f) => f.replace(/-r\d\.png$/, '')))].sort();
const COLS = 6, rows = Math.ceil(names.length / COLS);
for (let rot = 0; rot < 4; rot++) {
  const comps: sharp.OverlayOptions[] = [];
  for (let i = 0; i < names.length; i++) {
    const x = (i % COLS) * W, y = Math.floor(i / COLS) * H;
    const crop = await sharp(`${dir}/${names[i]}-r${rot}.png`).extract({ left, top, width: W, height: H }).png().toBuffer();
    comps.push({ input: crop, left: x, top: y });
    const label = names[i]!.replace(/^f(\d+)-/, '$1 ');
    comps.push({ input: Buffer.from(`<svg width="${W}" height="22"><rect width="${W}" height="22" fill="#000" fill-opacity="0.65"/><text x="6" y="16" font-family="monospace" font-size="13" fill="#fff">${label}</text></svg>`), left: x, top: y });
  }
  await sharp({ create: { width: COLS * W, height: rows * H, channels: 3, background: '#222' } }).composite(comps).png().toFile(`${out}/${prefix}-r${rot}.png`);
}
console.log(names.length, 'frames');
