// usage: node build-strip.cjs <out.png> <cols> <scale> <runDir>/<frame>|<caption> ...
const fs = require('fs');
const path = require('path');
const sharp = require('/home/sprite/org/workspace/opencoaster/node_modules/sharp');

const [out, colsArg, scaleArg, ...items] = process.argv.slice(2);
const cols = Number(colsArg);
const scale = Number(scaleArg);

(async () => {
  const parsed = items.map((s) => {
    const [file, ...cap] = s.split('|');
    return { file, caption: cap.join('|') };
  });
  const metas = await Promise.all(parsed.map((p) => sharp(p.file).metadata()));
  const w = Math.round(Math.max(560, ...metas.map((m) => m.width)) * scale);
  const h = Math.round(Math.max(340, ...metas.map((m) => m.height)) * scale);
  const bar = 22;
  const rows = Math.ceil(parsed.length / cols);
  const tiles = [];
  for (let i = 0; i < parsed.length; i++) {
    const img = await sharp(parsed[i].file).resize(w, h, { kernel: 'nearest' }).toBuffer();
    const svg = Buffer.from(
      `<svg width="${w}" height="${bar}"><rect width="${w}" height="${bar}" fill="#111"/><text x="8" y="15" font-family="monospace" font-size="13" fill="#e8e8e8">${parsed[i].caption.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`,
    );
    const left = (i % cols) * w;
    const top = Math.floor(i / cols) * (h + bar);
    tiles.push({ input: svg, left, top });
    tiles.push({ input: img, left, top: top + bar });
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await sharp({ create: { width: w * cols, height: (h + bar) * rows, channels: 3, background: '#000' } })
    .composite(tiles)
    .png()
    .toFile(out);
})();
